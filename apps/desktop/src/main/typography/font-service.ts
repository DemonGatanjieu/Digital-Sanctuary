import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  BUILTIN_TYPOGRAPHY_PRESETS,
  type TypographyFontDescriptor
} from "@sanctuary/domain";
import {
  validateFontFile,
  type ValidatedFontMetadata
} from "./font-file-validator.js";

export interface CustomFontRecord {
  id: string;
  sha256: string;
  format: "ttf" | "otf";
  family: string;
  fullName: string;
  postscriptName?: string;
  weight?: number;
  style: "normal" | "italic" | "oblique";
  variable: boolean;
  byteSize: number;
  fileName: string;
  importedAt: string;
}

export interface FontIndexV1 {
  version: 1;
  fonts: CustomFontRecord[];
}

export class FontService {
  private readonly fontsDir: string;
  private readonly filesDir: string;
  private readonly indexFile: string;
  private cache: Map<string, CustomFontRecord> = new Map();
  private initialized = false;

  constructor(userDataPath: string) {
    this.fontsDir = join(userDataPath, "fonts");
    this.filesDir = join(this.fontsDir, "files");
    this.indexFile = join(this.fontsDir, "index.v1.json");
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.filesDir, { recursive: true });
    await this.loadIndex();
    this.initialized = true;
  }

  private async loadIndex(): Promise<void> {
    this.cache.clear();
    if (!existsSync(this.indexFile)) {
      return;
    }

    try {
      const content = await readFile(this.indexFile, "utf8");
      const data = JSON.parse(content) as FontIndexV1;
      if (data && data.version === 1 && Array.isArray(data.fonts)) {
        for (const font of data.fonts) {
          if (font.id && font.sha256 && font.fileName) {
            // Verify file exists on disk, else mark missing
            const absPath = join(this.filesDir, font.fileName);
            if (existsSync(absPath)) {
              this.cache.set(font.id, font);
            }
          }
        }
      }
    } catch {
      // In case of corrupt index, start with empty cache
      this.cache.clear();
    }
  }

  private async saveIndex(): Promise<void> {
    const data: FontIndexV1 = {
      version: 1,
      fonts: Array.from(this.cache.values())
    };
    const tmpFile = `${this.indexFile}.tmp.${Date.now()}`;
    await writeFile(tmpFile, JSON.stringify(data, null, 2), "utf8");
    await rename(tmpFile, this.indexFile);
  }

  async listFonts(): Promise<TypographyFontDescriptor[]> {
    await this.init();

    const presets: TypographyFontDescriptor[] = [...BUILTIN_TYPOGRAPHY_PRESETS];

    const customs: TypographyFontDescriptor[] = Array.from(this.cache.values()).map((font) => {
      const exists = existsSync(join(this.filesDir, font.fileName));
      const descriptor: TypographyFontDescriptor = {
        id: font.id,
        source: "custom",
        family: font.family,
        fullName: font.fullName,
        style: font.style,
        variable: font.variable,
        supportedSlots: ["body", "display", "editorial"],
        status: exists ? "available" : "missing"
      };
      if (font.postscriptName) {
        descriptor.postscriptName = font.postscriptName;
      }
      if (font.weight) {
        descriptor.weight = font.weight;
      }
      return descriptor;
    });

    return [...presets, ...customs];
  }

  async importFont(sourceFilePath: string): Promise<TypographyFontDescriptor> {
    await this.init();

    const metadata: ValidatedFontMetadata = await validateFontFile(sourceFilePath);

    // Check if duplicate sha256 already exists in cache
    const existing = Array.from(this.cache.values()).find((f) => f.sha256 === metadata.sha256);
    if (existing) {
      const desc: TypographyFontDescriptor = {
        id: existing.id,
        source: "custom",
        family: existing.family,
        fullName: existing.fullName,
        style: existing.style,
        variable: existing.variable,
        supportedSlots: ["body", "display", "editorial"],
        status: "available"
      };
      if (existing.postscriptName) {
        desc.postscriptName = existing.postscriptName;
      }
      if (existing.weight) {
        desc.weight = existing.weight;
      }
      return desc;
    }

    const fontId = `custom_${metadata.sha256.slice(0, 12)}`;
    const fileName = `${metadata.sha256}.${metadata.format}`;
    const destinationPath = join(this.filesDir, fileName);

    await copyFile(sourceFilePath, destinationPath);

    const record: CustomFontRecord = {
      id: fontId,
      sha256: metadata.sha256,
      format: metadata.format,
      family: metadata.family,
      fullName: metadata.fullName,
      style: metadata.style,
      variable: metadata.variable,
      byteSize: metadata.byteSize,
      fileName,
      importedAt: new Date().toISOString()
    };
    if (metadata.postscriptName) {
      record.postscriptName = metadata.postscriptName;
    }
    if (metadata.weight) {
      record.weight = metadata.weight;
    }

    this.cache.set(fontId, record);
    await this.saveIndex();

    const descriptor: TypographyFontDescriptor = {
      id: fontId,
      source: "custom",
      family: record.family,
      fullName: record.fullName,
      style: record.style,
      variable: record.variable,
      supportedSlots: ["body", "display", "editorial"],
      status: "available"
    };
    if (record.postscriptName) {
      descriptor.postscriptName = record.postscriptName;
    }
    if (record.weight) {
      descriptor.weight = record.weight;
    }
    return descriptor;
  }

  async deleteFont(fontId: string): Promise<boolean> {
    await this.init();

    const record = this.cache.get(fontId);
    if (!record) return false;

    this.cache.delete(fontId);
    await this.saveIndex();

    // Remove file from disk if no other record references it
    const otherReferences = Array.from(this.cache.values()).some((f) => f.fileName === record.fileName);
    if (!otherReferences) {
      const absPath = join(this.filesDir, record.fileName);
      try {
        if (existsSync(absPath)) {
          await unlink(absPath);
        }
      } catch {}
    }

    return true;
  }

  resolveFontPath(fontId: string): string | null {
    if (!fontId || typeof fontId !== "string") return null;
    const cleanId = fontId.trim();
    const record = this.cache.get(cleanId);
    if (!record) return null;

    const targetPath = resolve(this.filesDir, record.fileName);
    // Security check: ensure targetPath is strictly inside filesDir
    if (!targetPath.startsWith(resolve(this.filesDir))) {
      return null;
    }

    return existsSync(targetPath) ? targetPath : null;
  }
}
