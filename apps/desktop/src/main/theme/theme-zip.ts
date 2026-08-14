import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ZIP_ENTRIES = 64;
const MAX_UNCOMPRESSED_BYTES = 24 * 1024 * 1024;

export function extractThemeZip(buffer: Buffer): Map<string, Buffer> {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0) throw new Error("Multi-volume theme ZIP files are not supported");
  if (entryCount === 0 || entryCount > MAX_ZIP_ENTRIES) throw new Error("Theme ZIP has an invalid entry count");
  if (centralOffset + centralSize > buffer.length) throw new Error("Theme ZIP central directory is truncated");

  const files = new Map<string, Buffer>();
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    ensureReadable(buffer, cursor, 46);
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_ENTRY) throw new Error("Theme ZIP central directory is invalid");
    const flags = buffer.readUInt16LE(cursor + 8);
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    ensureReadable(buffer, cursor + 46, nameLength + extraLength + commentLength);
    if ((flags & 0x1) !== 0) throw new Error("Encrypted theme ZIP files are not supported");
    if (compression !== 0 && compression !== 8) throw new Error("Theme ZIP uses an unsupported compression method");
    const name = normalizeZipEntryName(buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error("Theme ZIP expands beyond 24 MiB");
    if (files.has(name)) throw new Error(`Theme ZIP contains duplicate entry ${name}`);
    ensureReadable(buffer, localOffset, 30);
    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new Error("Theme ZIP local header is invalid");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    ensureReadable(buffer, dataOffset, compressedSize);
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const content = compression === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: uncompressedSize });
    if (content.byteLength !== uncompressedSize) throw new Error(`Theme ZIP entry ${name} has an invalid size`);
    files.set(name, content);
  }
  return files;
}

export function selectThemePackageRoot(files: Map<string, Buffer>): Map<string, Buffer> {
  const manifests = [...files.keys()].filter((name) => name === "theme.json" || name.endsWith("/theme.json"));
  if (manifests.length !== 1) throw new Error("Theme ZIP must contain exactly one theme.json");
  const manifestPath = manifests[0]!;
  const prefix = manifestPath.slice(0, -"theme.json".length);
  return new Map(
    [...files.entries()]
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, content]) => [name.slice(prefix.length), content]),
  );
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error("Theme ZIP end record was not found");
}

function normalizeZipEntryName(value: string): string {
  const name = value.replaceAll("\\", "/");
  if (
    !name ||
    name.includes("\uFFFD") ||
    name.startsWith("/") ||
    name.includes(":") ||
    name.split("/").some((segment) => segment === "." || segment === "..")
  ) throw new Error("Theme ZIP contains an unsafe path");
  return name;
}

function ensureReadable(buffer: Buffer, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error("Theme ZIP is truncated");
  }
}
