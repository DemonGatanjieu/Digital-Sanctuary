import { randomUUID, createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { stat, mkdir, copyFile, unlink, lstat, realpath, rmdir } from "node:fs/promises";
import { basename, extname, resolve, join, dirname } from "node:path";
import type { LibraryDatabase } from "@sanctuary/database";
import type { LocalImportBatch, LocalImportOptions } from "@sanctuary/domain";

type ImportDatabase = Pick<LibraryDatabase, "findLocalImportMatch" | "commitLocalImport" | "listCollections">;
interface Session { owner: number; batch: LocalImportBatch; paths: string[]; touched: number }

/** Only native-picker paths enter this service. Renderer commands use an owner-bound opaque id. */
export class LocalImportService {
  #sessions = new Map<string, Session>();
  constructor(private database: ImportDatabase, private fingerprint = fingerprintImage, private managedDirectory?: () => string) {}

  choose(owner: number, paths: string[]): LocalImportBatch | null {
    this.#prune();
    const active = [...this.#sessions.values()].find((s) => s.batch.phase === "running");
    if (active) return structuredClone(this.#owned(owner, active.batch.id).batch);
    if (!paths.length) return null;
    if (paths.length > 500) throw new Error("一次最多导入 500 张图片，请分批选择");
    for (const [id, session] of this.#sessions) if (session.owner === owner && session.batch.phase === "ready") this.#sessions.delete(id);
    const unique = [...new Map(paths.map((path) => [resolve(path).toLowerCase(), resolve(path)])).values()];
    const batch: LocalImportBatch = { id: randomUUID(), phase: "ready", collectionId: null,
      duplicatePolicy: "reuse", storageMode: "copy", cancelRequested: false,
      items: unique.map((path) => ({ id: randomUUID(), fileName: basename(path), status: "pending" })) };
    this.#sessions.set(batch.id, { owner, batch, paths: unique, touched: Date.now() });
    return structuredClone(batch);
  }

  get(owner: number, id: unknown): LocalImportBatch {
    return structuredClone(this.#owned(owner, id).batch);
  }

  start(owner: number, id: unknown, value: unknown): LocalImportBatch {
    const session = this.#owned(owner, id);
    if (session.batch.phase !== "ready") throw new Error("这批图片已经开始处理");
    const options = parseImportOptions(value);
    if (!options) throw new Error("导入选项无效，请重新选择");
    if (options.collectionId && !this.database.listCollections().some((c) => c.id === options.collectionId)) {
      throw new Error("相册已不存在，请重新选择相册");
    }
    Object.assign(session.batch, options);
    session.batch.storageMode = options.storageMode ?? "reference";
    this.#launch(session);
    return structuredClone(session.batch);
  }

  cancel(owner: number, id: unknown): LocalImportBatch {
    const session = this.#owned(owner, id);
    session.batch.cancelRequested = true;
    if (session.batch.phase === "ready") {
      session.batch.phase = "cancelled";
      for (const item of session.batch.items) item.status = "cancelled";
    }
    return structuredClone(session.batch);
  }

  retry(owner: number, id: unknown): LocalImportBatch {
    const session = this.#owned(owner, id);
    if (session.batch.phase === "running") throw new Error("请等待当前导入完成");
    if (!session.batch.items.some((item) => item.status === "failed")) return structuredClone(session.batch);
    for (const item of session.batch.items) if (item.status === "failed") { item.status = "pending"; delete item.error; }
    session.batch.cancelRequested = false;
    this.#launch(session);
    return structuredClone(session.batch);
  }

  #launch(session: Session) {
    if ([...this.#sessions.values()].some((s) => s !== session && s.batch.phase === "running")) throw new Error("已有一批图片正在导入");
    session.batch.phase = "running";
    void this.#run(session);
  }

  async #run(session: Session) {
    const { batch, paths } = session;
    for (let index = 0; index < batch.items.length; index += 1) {
      const item = batch.items[index]!;
      if (item.status !== "pending") continue;
      if (batch.cancelRequested) { item.status = "cancelled"; continue; }
      try {
        const path = paths[index]!;
        const hash = await this.fingerprint(path);
        if (batch.cancelRequested) { item.status = "cancelled"; continue; }
        const copy = batch.storageMode === "copy";
        let match = this.database.findLocalImportMatch(path, batch.duplicatePolicy === "reuse" ? hash : undefined, copy ? "managed" : "external");
        const samePath = match?.path.toLowerCase() === path.toLowerCase();
        // Cached hashes may describe a file that has since changed or disappeared.
        if (match && !samePath && await this.fingerprint(match.path).catch(() => null) !== hash) match = null;
        if (batch.cancelRequested) { item.status = "cancelled"; continue; }
        let copied: string | undefined;
        try {
          if (copy && !match) {
            if (!this.managedDirectory) throw new Error("图库保存位置尚未就绪，请重新打开软件");
            let root = resolve(this.managedDirectory());
            await mkdir(root, { recursive: true });
            if ((await lstat(root)).isSymbolicLink()) throw new Error("图库保存目录被重定向，请重新选择保存位置");
            root = await realpath(root);
            const folder = join(root, randomUUID());
            await mkdir(folder);
            copied = join(folder, basename(path));
            await copyFile(path, copied, constants.COPYFILE_EXCL);
            if (await this.fingerprint(copied) !== hash || await this.fingerprint(path) !== hash) throw new Error("图片在复制时发生变化，请重试");
            if (batch.cancelRequested) { item.status = "cancelled"; continue; }
          }
          item.artworkId = this.database.commitLocalImport(copied ?? path, hash, batch.collectionId, match?.artworkId, copy ? "managed" : "external");
          copied = undefined;
        } finally { if (copied) { await unlink(copied).catch(() => undefined); await rmdir(dirname(copied)).catch(() => undefined); } }
        item.status = match ? samePath ? "existing" : "duplicate" : "imported";
      } catch (error) {
        item.status = "failed";
        item.error = importErrorMessage(error);
      }
      session.touched = Date.now();
    }
    batch.phase = batch.cancelRequested ? "cancelled" : "completed";
    session.touched = Date.now();
  }

  #owned(owner: number, value: unknown): Session {
    this.#prune();
    if (typeof value !== "string" || value.length > 100) throw new Error("导入记录无效，请重新选择图片");
    const session = this.#sessions.get(value);
    if (!session || session.owner !== owner) throw new Error("导入记录已过期，请重新选择图片");
    session.touched = Date.now();
    return session;
  }

  #prune() {
    for (const [id, session] of this.#sessions) {
      if (session.batch.phase !== "running" && Date.now() - session.touched > 30 * 60_000) this.#sessions.delete(id);
    }
    const completed = [...this.#sessions.values()].filter((s) => s.batch.phase !== "running").sort((a, b) => b.touched - a.touched);
    for (const session of completed.slice(8)) this.#sessions.delete(session.batch.id);
  }
}

export function parseImportOptions(value: unknown): LocalImportOptions | null {
  if (!value || typeof value !== "object") return null;
  const options = value as Partial<LocalImportOptions>;
  if (options.duplicatePolicy !== "reuse" && options.duplicatePolicy !== "separate") return null;
  if (options.storageMode !== undefined && options.storageMode !== "copy" && options.storageMode !== "reference") return null;
  if (options.collectionId !== null && (typeof options.collectionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,299}$/.test(options.collectionId))) return null;
  return { collectionId: options.collectionId, duplicatePolicy: options.duplicatePolicy, ...(options.storageMode ? { storageMode: options.storageMode } : {}) };
}

export async function fingerprintImage(path: string): Promise<string> {
  const before = await stat(path);
  if (!before.isFile() || before.size === 0 || before.size > 512 * 1024 * 1024) throw new Error("请选择小于 512 MB 的图片文件");
  if (!/\.(jpe?g|png|webp|gif|avif)$/i.test(extname(path))) throw new Error("支持 JPG、PNG、WebP、GIF 和 AVIF 图片");
  const hash = createHash("sha256");
  let header: Buffer | undefined;
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    const bytes = chunk as Buffer;
    header ??= bytes.subarray(0, 64);
    hash.update(bytes);
  }
  const valid = header && (header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || header[0] === 255 && header[1] === 216 && header[2] === 255
    || /^GIF8[79]a/.test(header.toString("ascii", 0, 6))
    || header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP"
    || header.toString("ascii", 4, 8) === "ftyp" && /avif|avis/.test(header.toString("ascii", 8, 64)));
  if (!valid) throw new Error("文件内容不是可识别的图片，请检查文件后重试");
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error("文件在导入时发生变化，请等保存完成后重试");
  return hash.digest("hex");
}

function importErrorMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return "找不到文件，请恢复文件后重试";
  if (code === "EACCES" || code === "EPERM") return "无法读取文件，请检查访问权限后重试";
  return error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : "这张图片导入失败，请检查文件后重试";
}
