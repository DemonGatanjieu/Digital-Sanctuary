import { describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FontService } from "./font-service.js";

function createMockTtfBuffer(family = "Custom Test Font"): Buffer {
  const numTables = 3;
  const headerLen = 12 + numTables * 16;
  const fullName = `${family} Regular`;

  const stringBuf = Buffer.from(family + "\0" + fullName, "ascii");
  const nameHeaderLen = 6 + 2 * 12;
  const nameTableLen = nameHeaderLen + stringBuf.length;
  const nameBuf = Buffer.alloc(nameTableLen);
  nameBuf.writeUInt16BE(0, 0);
  nameBuf.writeUInt16BE(2, 2);
  nameBuf.writeUInt16BE(nameHeaderLen, 4);

  nameBuf.writeUInt16BE(3, 6);
  nameBuf.writeUInt16BE(0, 8);
  nameBuf.writeUInt16BE(0, 10);
  nameBuf.writeUInt16BE(1, 12);
  nameBuf.writeUInt16BE(family.length, 14);
  nameBuf.writeUInt16BE(0, 16);

  nameBuf.writeUInt16BE(3, 18);
  nameBuf.writeUInt16BE(0, 20);
  nameBuf.writeUInt16BE(0, 22);
  nameBuf.writeUInt16BE(4, 24);
  nameBuf.writeUInt16BE(fullName.length, 26);
  nameBuf.writeUInt16BE(family.length + 1, 28);

  stringBuf.copy(nameBuf, nameHeaderLen);

  const headBuf = Buffer.alloc(54);
  headBuf.writeUInt32BE(0x00010000, 0);
  headBuf.writeUInt32BE(0x5f0f3cf5, 12);

  const os2Buf = Buffer.alloc(86);
  os2Buf.writeUInt16BE(500, 4); // Medium
  os2Buf.writeUInt16BE(0, 62);

  const totalLen = headerLen + nameBuf.length + headBuf.length + os2Buf.length;
  const buf = Buffer.alloc(totalLen);

  buf.writeUInt32BE(0x00010000, 0);
  buf.writeUInt16BE(numTables, 4);
  buf.writeUInt16BE(32, 6);
  buf.writeUInt16BE(1, 8);
  buf.writeUInt16BE(16, 10);

  let currentOffset = headerLen;
  buf.write("head", 12, 4, "ascii");
  buf.writeUInt32BE(0, 16);
  buf.writeUInt32BE(currentOffset, 20);
  buf.writeUInt32BE(headBuf.length, 24);
  headBuf.copy(buf, currentOffset);
  currentOffset += headBuf.length;

  buf.write("name", 28, 4, "ascii");
  buf.writeUInt32BE(0, 32);
  buf.writeUInt32BE(currentOffset, 36);
  buf.writeUInt32BE(nameBuf.length, 40);
  nameBuf.copy(buf, currentOffset);
  currentOffset += nameBuf.length;

  buf.write("OS/2", 44, 4, "ascii");
  buf.writeUInt32BE(0, 48);
  buf.writeUInt32BE(currentOffset, 52);
  buf.writeUInt32BE(os2Buf.length, 56);
  os2Buf.copy(buf, currentOffset);

  return buf;
}

describe("FontService", () => {
  it("imports, indexes, lists, resolves and deletes custom fonts", async () => {
    const testDir = join(tmpdir(), `sanctuary-font-service-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    const sourceFontPath = join(testDir, "source.ttf");
    await writeFile(sourceFontPath, createMockTtfBuffer("LXGW WenKai"));

    try {
      const service = new FontService(testDir);
      await service.init();

      const initialList = await service.listFonts();
      expect(initialList.length).toBeGreaterThanOrEqual(3); // builtins

      // 1. Import font
      const imported = await service.importFont(sourceFontPath);
      expect(imported.source).toBe("custom");
      expect(imported.family).toBe("LXGW WenKai");
      expect(imported.status).toBe("available");

      // 2. Listing reflects imported font
      const updatedList = await service.listFonts();
      const customItem = updatedList.find((f) => f.id === imported.id);
      expect(customItem).toBeDefined();
      expect(customItem?.family).toBe("LXGW WenKai");

      // 3. Resolve path
      const resolved = service.resolveFontPath(imported.id);
      expect(resolved).toBeTruthy();
      expect(resolved?.endsWith(".ttf")).toBe(true);

      // Security check: path traversal attempts return null
      expect(service.resolveFontPath("../../../etc/passwd")).toBeNull();
      expect(service.resolveFontPath("non_existent")).toBeNull();

      // 4. Duplicate import returns same font ID without duplicate file
      const dup = await service.importFont(sourceFontPath);
      expect(dup.id).toBe(imported.id);

      // 5. Delete font
      const deleted = await service.deleteFont(imported.id);
      expect(deleted).toBe(true);

      const afterDelete = await service.listFonts();
      expect(afterDelete.find((f) => f.id === imported.id)).toBeUndefined();
      expect(service.resolveFontPath(imported.id)).toBeNull();
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
