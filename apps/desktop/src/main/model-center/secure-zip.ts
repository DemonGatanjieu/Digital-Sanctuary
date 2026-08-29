import { inflateRawSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ENTRIES = 512;
const MAX_TOTAL_UNCOMPRESSED = 768 * 1024 * 1024;

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  directory: boolean;
}

export async function extractTrustedZip(archivePath: string, destination: string): Promise<string[]> {
  const buffer = await readFile(archivePath);
  const entries = parseCentralDirectory(buffer);
  const destinationRoot = resolve(destination);
  const extracted: string[] = [];
  let totalUncompressed = 0;

  for (const entry of entries) {
    totalUncompressed += entry.uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) throw new Error("模型运行时解压体积超过安全上限。");
    const target = safeArchiveTarget(destinationRoot, entry.name);
    if (entry.directory) {
      await mkdir(target, { recursive: true });
      continue;
    }
    const localOffset = entry.localHeaderOffset;
    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new Error("模型运行时 ZIP 本地文件头损坏。");
    const fileNameLength = buffer.readUInt16LE(localOffset + 26);
    const extraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + fileNameLength + extraLength;
    const dataEnd = dataOffset + entry.compressedSize;
    if (dataOffset < 0 || dataEnd > buffer.length) throw new Error("模型运行时 ZIP 数据越界。");
    const compressed = buffer.subarray(dataOffset, dataEnd);
    const content = entry.compression === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize });
    if (content.length !== entry.uncompressedSize) throw new Error(`模型运行时文件大小异常：${entry.name}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    extracted.push(target);
  }
  return extracted;
}

function parseCentralDirectory(buffer: Buffer): ZipEntry[] {
  const minOffset = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("模型运行时 ZIP 缺少中央目录。");
  if (buffer.readUInt16LE(endOffset + 4) !== 0 || buffer.readUInt16LE(endOffset + 6) !== 0) {
    throw new Error("不支持分卷模型运行时 ZIP。");
  }
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (entryCount > MAX_ENTRIES || centralOffset + centralSize > buffer.length) {
    throw new Error("模型运行时 ZIP 中央目录超出安全上限。");
  }

  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) throw new Error("模型运行时 ZIP 中央目录损坏。");
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    if ((flags & 0x1) !== 0 || ![0, 8].includes(compression)) throw new Error("模型运行时 ZIP 使用了不支持的加密或压缩方式。");
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > buffer.length) throw new Error("模型运行时 ZIP 文件名越界。");
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8").replaceAll("\\", "/");
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
