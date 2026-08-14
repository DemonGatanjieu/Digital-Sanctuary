import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import type { TypographySlot } from "@sanctuary/domain";

export const MAX_FONT_FILE_BYTES = 32 * 1024 * 1024; // 32 MiB

export interface ValidatedFontMetadata {
  sha256: string;
  format: "ttf" | "otf";
  family: string;
  fullName: string;
  postscriptName?: string;
  weight?: number;
  style: "normal" | "italic" | "oblique";
  variable: boolean;
  supportedSlots: TypographySlot[];
  byteSize: number;
}

export type FontValidationError =
  | "FILE_NOT_FOUND"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "CORRUPT_FONT_TABLE"
  | "MISSING_NAME_TABLE"
  | "READ_ERROR";

export class FontValidationException extends Error {
  constructor(public readonly code: FontValidationError, message: string) {
    super(`[${code}] ${message}`);
    this.name = "FontValidationException";
  }
}

/**
 * Validates a TTF / OTF font file from disk.
 * Performs rigorous SFNT header and table structure verification.
 */
export async function validateFontFile(filePath: string): Promise<ValidatedFontMetadata> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new FontValidationException("FILE_NOT_FOUND", "Font file does not exist or cannot be accessed.");
  }

  if (!fileStat.isFile()) {
    throw new FontValidationException("UNSUPPORTED_FORMAT", "Path is not a regular file.");
  }

  if (fileStat.size > MAX_FONT_FILE_BYTES) {
    throw new FontValidationException("FILE_TOO_LARGE", `Font file exceeds 32 MiB size limit (${fileStat.size} bytes).`);
  }

  if (fileStat.size < 128) {
    throw new FontValidationException("UNSUPPORTED_FORMAT", "Font file is too small to contain valid SFNT headers.");
  }

  const fd = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(fileStat.size);
    const { bytesRead } = await fd.read(buffer, 0, fileStat.size, 0);
    if (bytesRead !== fileStat.size) {
      throw new FontValidationException("READ_ERROR", "Could not read complete font buffer.");
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");

    // 1. Validate SFNT header (first 4 bytes)
    const sfntVersion = buffer.readUInt32BE(0);
    let format: "ttf" | "otf";
    if (sfntVersion === 0x00010000 || sfntVersion === 0x74727565 /* 'true' */) {
      format = "ttf";
    } else if (sfntVersion === 0x4f54544f /* 'OTTO' */) {
      format = "otf";
    } else {
      throw new FontValidationException(
        "UNSUPPORTED_FORMAT",
        `Unsupported font magic tag: 0x${sfntVersion.toString(16).padStart(8, "0")}. Only standard TTF and OTF are supported.`
      );
    }

    const numTables = buffer.readUInt16BE(4);
    if (numTables === 0 || numTables > 120) {
      throw new FontValidationException("CORRUPT_FONT_TABLE", `Invalid table count in SFNT header: ${numTables}`);
    }

    // 2. Parse table directory
    const tables = new Map<string, { offset: number; length: number }>();
    let dirOffset = 12;
    for (let i = 0; i < numTables; i++) {
      if (dirOffset + 16 > buffer.length) {
        throw new FontValidationException("CORRUPT_FONT_TABLE", "SFNT table directory truncated.");
      }
      const tag = buffer.toString("ascii", dirOffset, dirOffset + 4);
      const offset = buffer.readUInt32BE(dirOffset + 8);
      const length = buffer.readUInt32BE(dirOffset + 12);

      if (offset + length > buffer.length) {
        throw new FontValidationException("CORRUPT_FONT_TABLE", `Table '${tag}' offset (${offset} + ${length}) exceeds file bounds.`);
      }

      tables.set(tag, { offset, length });
      dirOffset += 16;
    }

    // 3. Verify 'head' table magic number if present
    const headTable = tables.get("head");
    if (headTable) {
      if (headTable.length >= 16) {
        const headMagic = buffer.readUInt32BE(headTable.offset + 12);
        if (headMagic !== 0x5f0f3cf5) {
          throw new FontValidationException("CORRUPT_FONT_TABLE", `Invalid 'head' table magic: 0x${headMagic.toString(16)}`);
        }
      }
    }

    // 4. Parse 'name' table for Family, Full Name, PostScript Name
    const nameTable = tables.get("name");
    if (!nameTable) {
      throw new FontValidationException("MISSING_NAME_TABLE", "Font is missing required 'name' table.");
    }

    const nameRecords = parseNameTable(buffer, nameTable.offset, nameTable.length);
    const family = nameRecords.family || "Custom Font";
    const fullName = nameRecords.fullName || family;
    const postscriptName = nameRecords.postscriptName;

    // 5. Parse 'OS/2' table for weight and style flags
    let weight: number | undefined;
    let style: "normal" | "italic" | "oblique" = "normal";
    const os2Table = tables.get("OS/2");
    if (os2Table && os2Table.length >= 64) {
      const usWeightClass = buffer.readUInt16BE(os2Table.offset + 4);
      if (usWeightClass >= 100 && usWeightClass <= 900) {
        weight = usWeightClass;
      }
      const fsSelection = buffer.readUInt16BE(os2Table.offset + 62);
      if (fsSelection & 0x01) {
        style = "italic";
      } else if (fsSelection & 0x200) {
        style = "oblique";
      }
    }

    // Check for variable font tables (fvar)
    const variable = tables.has("fvar");

    const supportedSlots: TypographySlot[] = ["body", "display", "editorial"];

    const result: ValidatedFontMetadata = {
      sha256,
      format,
      family,
      fullName,
      style,
      variable,
      supportedSlots,
      byteSize: fileStat.size
    };
    if (postscriptName) {
      result.postscriptName = postscriptName;
    }
    if (weight) {
      result.weight = weight;
    }

    return result;
  } finally {
    await fd.close();
  }
}

interface ExtractedNames {
  family?: string;
  fullName?: string;
  postscriptName?: string;
}

function parseNameTable(buffer: Buffer, tableOffset: number, tableLength: number): ExtractedNames {
  if (tableLength < 6) return {};

  const count = buffer.readUInt16BE(tableOffset + 2);
  const stringOffset = buffer.readUInt16BE(tableOffset + 4);
  const stringBase = tableOffset + stringOffset;

  const result: ExtractedNames = {};
  let recordOffset = tableOffset + 6;

  for (let i = 0; i < count; i++) {
    if (recordOffset + 12 > tableOffset + tableLength) break;

    const platformId = buffer.readUInt16BE(recordOffset);
    const encodingId = buffer.readUInt16BE(recordOffset + 2);
    const languageId = buffer.readUInt16BE(recordOffset + 4);
    const nameId = buffer.readUInt16BE(recordOffset + 6);
    const length = buffer.readUInt16BE(recordOffset + 8);
    const offset = buffer.readUInt16BE(recordOffset + 10);

    const strStart = stringBase + offset;
    if (strStart + length <= buffer.length && length > 0 && length <= 256) {
      let str = "";
      // Platform 0 (Unicode) or Platform 3 (Windows Unicode BMP / UTF-16BE)
      if (platformId === 0 || (platformId === 3 && (encodingId === 1 || encodingId === 10))) {
        str = decodeUtf16Be(buffer.subarray(strStart, strStart + length));
      } else if (platformId === 1 && encodingId === 0) {
        // Mac Roman
        str = buffer.toString("latin1", strStart, strStart + length);
      } else if (platformId === 3 && encodingId === 0) {
        // Symbol / ASCII
        str = buffer.toString("ascii", strStart, strStart + length);
      }

      str = str.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();

      if (str) {
        // Name IDs: 1 = Family, 4 = Full Name, 6 = PostScript Name
        if (nameId === 1 && (!result.family || languageId === 0x0409 || languageId === 0x0804)) {
          result.family = str;
        } else if (nameId === 4 && (!result.fullName || languageId === 0x0409 || languageId === 0x0804)) {
          result.fullName = str;
        } else if (nameId === 6 && !result.postscriptName) {
          result.postscriptName = str;
        }
      }
    }

    recordOffset += 12;
  }

  return result;
}

function decodeUtf16Be(buf: Buffer): string {
  const chars: string[] = [];
  for (let i = 0; i < buf.length - 1; i += 2) {
    const code = buf.readUInt16BE(i);
    if (code !== 0) chars.push(String.fromCharCode(code));
  }
  return chars.join("");
}
