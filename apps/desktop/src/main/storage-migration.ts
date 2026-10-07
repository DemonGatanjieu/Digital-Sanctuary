import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, realpath, stat, utimes } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import type { LibraryDatabase } from "@sanctuary/database";
import type { StorageMigrationResult } from "@sanctuary/domain";

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel);
}
async function hash(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function safeParent(root: string, physicalRoot: string, destination: string): Promise<void> {
  let current = root;
  for (const segment of relative(root, dirname(destination)).split(/[\\/]/).filter(Boolean)) {
    current = join(current, segment);
    if (await exists(current)) {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink() || !within(physicalRoot, await realpath(current))) throw new Error("目标文件夹包含链接或非目录，已停止迁移");
    } else await mkdir(current);
  }
}
/** Copy only indexed originals/avatars; never delete originals or overwrite a conflict. */
export async function migrateStorageFiles(database: LibraryDatabase, source: string, target: string, backupDirectory: string): Promise<StorageMigrationResult> {
  const sourceRoot = resolve(source), targetRoot = resolve(target);
  if (sourceRoot.toLowerCase() === targetRoot.toLowerCase()) return {
    migratedArtworks: 0, migratedAssets: 0, migratedAvatars: 0, sourceDirectory: sourceRoot, targetDirectory: targetRoot
  };
  if (parse(sourceRoot).root.toLowerCase() === sourceRoot.toLowerCase() || parse(targetRoot).root.toLowerCase() === targetRoot.toLowerCase() || within(sourceRoot, targetRoot) || within(targetRoot, sourceRoot)) {
    throw new Error("新旧图片目录不能是磁盘根目录，也不能互相包含，请另选一个独立文件夹");
  }
  const files = database.storageMigrationFiles(sourceRoot, targetRoot);
  if (!files.length) return { migratedArtworks: 0, migratedAssets: 0, migratedAvatars: 0, sourceDirectory: sourceRoot, targetDirectory: targetRoot };
  const roots = [
    { source: sourceRoot, target: targetRoot, physicalSource: sourceRoot, physicalTarget: targetRoot },
    { source: resolve(sourceRoot, "..", "avatars"), target: resolve(targetRoot, "..", "avatars"), physicalSource: "", physicalTarget: "" }
  ];
  // Resolve actual roots before copying, so junctions cannot send a file outside the selected storage.
  for (const root of roots) {
    if (!files.some((file) => within(root.source, file.sourcePath))) continue;
    root.physicalSource = await realpath(root.source);
    await mkdir(root.target, { recursive: true });
    root.physicalTarget = await realpath(root.target);
    if (within(root.physicalSource, root.physicalTarget) || within(root.physicalTarget, root.physicalSource)) throw new Error("新旧目录实际指向同一位置或互相包含，请检查文件夹链接");
  }
  await mkdir(backupDirectory, { recursive: true });
  database.backupTo(resolve(backupDirectory, `library.pre-storage-${Date.now()}-${randomUUID()}.db`));
  const verified = new Set<string>();
  const snapshots: { path: string; size: number; mtimeMs: number; ctimeMs: number }[] = [];
  for (const file of files) {
    if (!await exists(file.sourcePath)) throw new Error(`找不到原文件：${basename(file.sourcePath)}；图库未切换，请先恢复原文件`);
    const sourceInfo = await lstat(file.sourcePath);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error(`文件不是普通图片或已被替换：${basename(file.sourcePath)}；原文件已保留`);
    const physicalSource = await realpath(file.sourcePath);
    const root = roots.find((entry) => within(entry.source, file.sourcePath) && within(entry.target, file.targetPath));
    if (!root || !within(root.physicalSource, physicalSource)) throw new Error("图片路径超出了迁移目录，请检查文件夹链接；原文件已保留");
    await safeParent(root.target, root.physicalTarget, file.targetPath);
    const physicalParent = await realpath(dirname(file.targetPath));
    if (!within(root.physicalTarget, physicalParent)) throw new Error("目标路径超出了所选目录，请检查文件夹链接");
    const sourceHash = await hash(file.sourcePath);
    if (await exists(file.targetPath)) {
      const targetInfo = await lstat(file.targetPath);
      if (!targetInfo.isFile() || targetInfo.isSymbolicLink() || await hash(file.targetPath) !== sourceHash) {
        throw new Error(`目标已有不同内容的同名文件：${basename(file.targetPath)}；未覆盖，请另选空目录或处理冲突后重试`);
      }
    } else {
      await copyFile(file.sourcePath, file.targetPath, constants.COPYFILE_EXCL);
      if (await hash(file.targetPath) !== sourceHash) throw new Error(`复制校验失败：${basename(file.targetPath)}；图库未切换，原文件已保留`);
      await utimes(file.targetPath, sourceInfo.atime, sourceInfo.mtime);
    }
    snapshots.push({ path: file.sourcePath, size: sourceInfo.size, mtimeMs: sourceInfo.mtimeMs, ctimeMs: sourceInfo.ctimeMs });
    verified.add(file.sourcePath.toLowerCase());
  }
  for (const snapshot of snapshots) {
    const current = await stat(snapshot.path);
    if (current.size !== snapshot.size || current.mtimeMs !== snapshot.mtimeMs || current.ctimeMs !== snapshot.ctimeMs) throw new Error("复制期间原文件发生变化；图库未切换，请重试");
  }
  return database.migrateArtworkStoragePaths(sourceRoot, targetRoot, verified);
}
