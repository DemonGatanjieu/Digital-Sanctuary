import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
// Archives are SHA-256 pinned in the catalog; these caps only bound a corrupt or hostile file.
// The picture-search runtime (a frozen Python + PyTorch) is the largest: ~6k files, ~2 GB unpacked.
const MAX_ENTRIES = 16_384;
const MAX_TOTAL_UNCOMPRESSED = 3 * 1024 ** 3;
const MAX_ENTRY_UNCOMPRESSED = 1024 ** 3;

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  directory: boolean;
}

/** Extracts a ZIP32 archive by streaming each entry to disk, so large runtimes neither sit in memory nor block the main process. */
export async function extractTrustedZip(archivePath: string, destination: string): Promise<string[]> {
  const handle = await open(archivePath, "r");
  try {
    const { size } = await handle.stat();
    const entries = await readCentralDirectory(handle, size);
    const destinationRoot = resolve(destination);
    const extracted: string[] = [];
    let totalUncompressed = 0;

    for (const entry of entries) {
      totalUncompressed += entry.uncompressedSize;
      if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) throw new Error("模型运行时解压体积超过安全上限。");
      if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED) throw new Error(`模型运行时单个文件超过安全上限：${entry.name}`);
      const target = safeArchiveTarget(destinationRoot, entry.name);
      if (entry.directory) {
        await mkdir(target, { recursive: true });
        continue;
      }
      const header = await readAt(handle, entry.localHeaderOffset, 30, size);
      if (header.readUInt32LE(0) !== LOCAL_FILE_HEADER) throw new Error("模型运行时 ZIP 本地文件头损坏。");
      const dataOffset = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      if (dataOffset + entry.compressedSize > size) throw new Error("模型运行时 ZIP 数据越界。");
      await mkdir(dirname(target), { recursive: true });
      let written = 0;
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          written += chunk.length;
          done(written > entry.uncompressedSize ? new Error(`模型运行时文件大小异常：${entry.name}`) : null, chunk);
        }
      });
      const source = entry.compressedSize === 0
        ? Readable.from([])
        : createReadStream(archivePath, { start: dataOffset, end: dataOffset + entry.compressedSize - 1 });
      const output = createWriteStream(target);
      if (entry.compression === 0) await pipeline(source, limit, output);
      else await pipeline(source, createInflateRaw(), limit, output);
      if (written !== entry.uncompressedSize) throw new Error(`模型运行时文件大小异常：${entry.name}`);
      extracted.push(target);
    }
    return extracted;
  } finally {
    await handle.close();
  }
}

async function readAt(handle: FileHandle, offset: number, length: number, fileSize: number): Promise<Buffer> {
  if (offset < 0 || length < 0 || offset + length > fileSize) throw new Error("模型运行时 ZIP 数据越界。");
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(buffer, read, length - read, offset + read);
    if (bytesRead === 0) throw new Error("模型运行时 ZIP 数据越界。");
    read += bytesRead;
  }
  return buffer;
}

async function readCentralDirectory(handle: FileHandle, fileSize: number): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, fileSize - 65_557);
  const tail = await readAt(handle, tailStart, fileSize - tailStart, fileSize);
  let endOffset = -1;
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("模型运行时 ZIP 缺少中央目录。");
  if (tail.readUInt16LE(endOffset + 4) !== 0 || tail.readUInt16LE(endOffset + 6) !== 0) {
    throw new Error("不支持分卷模型运行时 ZIP。");
  }
  const entryCount = tail.readUInt16LE(endOffset + 10);
  const centralSize = tail.readUInt32LE(endOffset + 12);
  const centralOffset = tail.readUInt32LE(endOffset + 16);
  if (entryCount > MAX_ENTRIES || centralOffset + centralSize > fileSize) {
    throw new Error("模型运行时 ZIP 中央目录超出安全上限。");
  }
  const central = await readAt(handle, centralOffset, centralSize, fileSize);

  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > central.length || central.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error("模型运行时 ZIP 中央目录损坏。");
    }
    const flags = central.readUInt16LE(offset + 8);
    const compression = central.readUInt16LE(offset + 10);
    const compressedSize = central.readUInt32LE(offset + 20);
    const uncompressedSize = central.readUInt32LE(offset + 24);
    const fileNameLength = central.readUInt16LE(offset + 28);
    const extraLength = central.readUInt16LE(offset + 30);
    const commentLength = central.readUInt16LE(offset + 32);
    const localHeaderOffset = central.readUInt32LE(offset + 42);
    if ((flags & 0x1) !== 0 || ![0, 8].includes(compression)) throw new Error("模型运行时 ZIP 使用了不支持的加密或压缩方式。");
    if ([compressedSize, uncompressedSize, localHeaderOffset].includes(0xffff_ffff)) throw new Error("不支持 ZIP64 模型运行时。");
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > central.length) throw new Error("模型运行时 ZIP 文件名越界。");
    const name = central.subarray(nameStart, nameEnd).toString("utf8").replaceAll("\\", "/");
    entries.push({
      name,
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      directory: name.endsWith("/")
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function safeArchiveTarget(root: string, name: string): string {
  if (!name || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.includes("\0")) {
    throw new Error("模型运行时 ZIP 包含不安全路径。");
  }
  const segments = name.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("模型运行时 ZIP 试图越出安装目录。");
  }
  const target = resolve(root, ...segments);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("模型运行时 ZIP 路径无效。");
  return target;
}
