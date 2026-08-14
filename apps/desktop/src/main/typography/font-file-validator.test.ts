import { describe, expect, it } from "vitest";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FontValidationException,
  validateFontFile
} from "./font-file-validator.js";

function createMockTtfBuffer(family = "Test Font", fullName = "Test Font Regular"): Buffer {
  // 12 bytes SFNT header + 3 tables (head, name, OS/2) = 12 + 3 * 16 = 60 bytes header
  const numTables = 3;
  const headerLen = 12 + numTables * 16;

  // Build name table
  const stringBuf = Buffer.from(family + "\0" + fullName, "ascii");
  // name table header: format=0, count=2, stringOffset=6 + 2*12 = 30
  const nameHeaderLen = 6 + 2 * 12;
  const nameTableLen = nameHeaderLen + stringBuf.length;
  const nameBuf = Buffer.alloc(nameTableLen);
  nameBuf.writeUInt16BE(0, 0); // format 0
  nameBuf.writeUInt16BE(2, 2); // count 2
  nameBuf.writeUInt16BE(nameHeaderLen, 4); // stringOffset

  // Record 1: Name ID 1 (Family), Plat 3, Enc 0, Lang 0
  nameBuf.writeUInt16BE(3, 6);
  nameBuf.writeUInt16BE(0, 8);
  nameBuf.writeUInt16BE(0, 10);
  nameBuf.writeUInt16BE(1, 12); // Name ID 1
  nameBuf.writeUInt16BE(family.length, 14); // length
  nameBuf.writeUInt16BE(0, 16); // offset

  // Record 2: Name ID 4 (Full Name)
  nameBuf.writeUInt16BE(3, 18);
  nameBuf.writeUInt16BE(0, 20);
  nameBuf.writeUInt16BE(0, 22);
  nameBuf.writeUInt16BE(4, 24); // Name ID 4
  nameBuf.writeUInt16BE(fullName.length, 26); // length
  nameBuf.writeUInt16BE(family.length + 1, 28); // offset

  stringBuf.copy(nameBuf, nameHeaderLen);

  // Build head table (54 bytes)
  const headBuf = Buffer.alloc(54);
  headBuf.writeUInt32BE(0x00010000, 0); // version
  headBuf.writeUInt32BE(0x5f0f3cf5, 12); // magicNumber

  // Build OS/2 table (86 bytes)
  const os2Buf = Buffer.alloc(86);
  os2Buf.writeUInt16BE(400, 4); // usWeightClass = 400
  os2Buf.writeUInt16BE(0, 62); // fsSelection = 0

  const totalLen = headerLen + nameBuf.length + headBuf.length + os2Buf.length;
  const buf = Buffer.alloc(totalLen);

  // Write SFNT header
  buf.writeUInt32BE(0x00010000, 0); // TTF version
  buf.writeUInt16BE(numTables, 4);
  buf.writeUInt16BE(32, 6); // searchRange
  buf.writeUInt16BE(1, 8); // entrySelector
  buf.writeUInt16BE(16, 10); // rangeShift

  let currentOffset = headerLen;

  // Table 1: head
  buf.write("head", 12, 4, "ascii");
  buf.writeUInt32BE(0, 16); // checkSum
  buf.writeUInt32BE(currentOffset, 20);
  buf.writeUInt32BE(headBuf.length, 24);
  headBuf.copy(buf, currentOffset);
  currentOffset += headBuf.length;

  // Table 2: name
  buf.write("name", 28, 4, "ascii");
  buf.writeUInt32BE(0, 32);
  buf.writeUInt32BE(currentOffset, 36);
  buf.writeUInt32BE(nameBuf.length, 40);
  nameBuf.copy(buf, currentOffset);
  currentOffset += nameBuf.length;

  // Table 3: OS/2
  buf.write("OS/2", 44, 4, "ascii");
  buf.writeUInt32BE(0, 48);
  buf.writeUInt32BE(currentOffset, 52);
  buf.writeUInt32BE(os2Buf.length, 56);
  os2Buf.copy(buf, currentOffset);

  return buf;
}

describe("Font File Validator", () => {
  it("validates a valid mock TrueType font file", async () => {
    const testDir = join(tmpdir(), `sanctuary-test-font-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    const fontPath = join(testDir, "valid.ttf");

    const buffer = createMockTtfBuffer("Smiley Sans", "Smiley Sans Oblique");
    await writeFile(fontPath, buffer);

    try {
      const metadata = await validateFontFile(fontPath);
      expect(metadata.format).toBe("ttf");
      expect(metadata.family).toBe("Smiley Sans");
      expect(metadata.fullName).toBe("Smiley Sans Oblique");
      expect(metadata.weight).toBe(400);
      expect(metadata.style).toBe("normal");
      expect(metadata.sha256).toHaveLength(64);
    } finally {
      await unlink(fontPath);
    }
  });

  it("rejects files with invalid magic tag", async () => {
    const testDir = join(tmpdir(), `sanctuary-test-font-bad-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    const fontPath = join(testDir, "fake.ttf");

    const buffer = Buffer.from("NOT_A_VALID_FONT_HEADER_DATA_12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890");
    await writeFile(fontPath, buffer);

    try {
      await expect(validateFontFile(fontPath)).rejects.toThrowError(FontValidationException);
    } finally {
      await unlink(fontPath);
    }
  });

  it("rejects truncated font files", async () => {
    const testDir = join(tmpdir(), `sanctuary-test-font-trunc-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    const fontPath = join(testDir, "trunc.ttf");

    await writeFile(fontPath, Buffer.from([0x00, 0x01, 0x00, 0x00])); // 4 bytes only

    try {
      await expect(validateFontFile(fontPath)).rejects.toThrowError(FontValidationException);
    } finally {
      await unlink(fontPath);
    }
  });
});
