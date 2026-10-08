import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, realpath, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { ImageTarget, ImageExportBatch, ImageTaskSummary } from "@sanctuary/domain";
import { fingerprintImage } from "./local-import-service.js";
import { parseWorkId } from "../shared/library-query.js";

export interface ResolvedImage { target: ImageTarget; path: string; fileName: string }
export interface ImageOutputHost {
  chooseDirectory(): Promise<string | null>;
  copyImage(path: string): Promise<void>;
  reveal(path: string): void | Promise<void>;
}
interface Session { owner: number; batch: ImageExportBatch; files: ResolvedImage[]; destination: string; touched: number }

export function parseImageTargets(value: unknown): ImageTarget[] {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new Error("请一次选择 1–500 项图片或作品");
  return value.map((target: unknown) => {
    if (!target || typeof target !== "object") throw new Error("图片选择无效");
    const t = target as Record<string, unknown>;
    if ("workId" in t) {
      const workId = parseWorkId(t.workId);
      if (!workId || (t.assetId !== undefined && (typeof t.assetId !== "string" || t.assetId.length > 300))) throw new Error("图片选择无效");
      return { workId, ...(typeof t.assetId === "string" ? { assetId: t.assetId } : {}) };
    }
    if (typeof t.sessionId !== "string" || typeof t.itemId !== "string" || t.sessionId.length > 100 || t.itemId.length > 100) throw new Error("图片选择无效");
    return { sessionId: t.sessionId, itemId: t.itemId };
  });
}

/** Native destination + trusted source resolver; no renderer-provided paths. */
export class ImageOutputService {
  #sessions = new Map<string, Session>();
  #choosing = false;
  constructor(private resolveImages: (owner: number, targets: ImageTarget[]) => Promise<ResolvedImage[]>, private host: ImageOutputHost) {}

  async start(owner: number, value: unknown): Promise<ImageExportBatch | null> {
    if (this.#choosing || [...this.#sessions.values()].some(s => s.batch.phase === "running")) throw new Error("已有图片正在复制，请等待完成或停止");
    this.#choosing = true;
    try {
      const files = await this.resolveImages(owner, parseImageTargets(value));
      if (!files.length || files.length > 1000) throw new Error("一次最多复制 1,000 张原图，请缩小选择范围");
      const destination = await this.host.chooseDirectory();
      if (!destination) return null;
      const info = await lstat(destination);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("请选择普通目标文件夹");
      const batch: ImageExportBatch = { id: randomUUID(), phase: "running", cancelRequested: false,
        items: files.map(file => ({ id: randomUUID(), target: file.target, fileName: file.fileName, status: "pending" })) };
      const session = { owner, batch, files, destination: await realpath(destination), touched: Date.now() };
      this.#prune(); this.#sessions.set(batch.id, session); void this.#run(session);
      return structuredClone(batch);
    } finally { this.#choosing = false; }
  }
  get(owner: number, id: unknown): ImageExportBatch { return structuredClone(this.#owned(owner, id).batch); }
  current(owner: number): ImageExportBatch | null { this.#prune(); const s=[...this.#sessions.values()].reverse().find(s=>s.owner===owner);return s?structuredClone(s.batch):null; }
  tasks(owner: number): ImageTaskSummary[] { const b=this.current(owner);return b?[{id:b.id,kind:"copy",source:b.items[0]&&"sessionId" in b.items[0].target?"folder":"library",name:"原图复制",
    phase:b.phase,total:b.items.length,processed:b.items.filter(i=>i.status==="copied"||i.status==="failed").length,failed:b.items.filter(i=>i.status==="failed").length,cancelRequested:b.cancelRequested}]:[]; }
  cancel(owner: number, id: unknown): ImageExportBatch { const s = this.#owned(owner, id); s.batch.cancelRequested = true; return structuredClone(s.batch); }
  retry(owner: number, id: unknown): ImageExportBatch {
    const s = this.#owned(owner, id);
    if (this.#choosing || [...this.#sessions.values()].some(item => item.batch.phase === "running")) throw new Error("请等待当前复制完成");
    for (const item of s.batch.items) if (item.status === "failed" || item.status === "cancelled") { item.status = "pending"; delete item.error; }
    s.batch.cancelRequested = false; s.batch.phase = "running"; void this.#run(s); return structuredClone(s.batch);
  }
  async use(owner: number, value: unknown, action: unknown): Promise<void> {
    if(action!=="copy"&&action!=="reveal")throw new Error("图片操作无效");
    const targets = parseImageTargets([value]);
    if (!("assetId" in targets[0]! || "itemId" in targets[0]!)) throw new Error("请先选择具体的一页图片");
    const files = await this.resolveImages(owner, targets);
    if (files.length !== 1) throw new Error("请先选择具体的一页图片");
    const file = files[0]!;
    if (action === "copy") { await fingerprintImage(file.path); await this.host.copyImage(file.path); }
    else await this.host.reveal(file.path);
  }
  async drag(owner: number, value: unknown, start: (path: string) => void): Promise<void> {
    const targets = parseImageTargets([value]);
    if (!("assetId" in targets[0]! || "itemId" in targets[0]!)) throw new Error("请先选择具体的一页图片");
    const files = await this.resolveImages(owner, targets);
    if (files.length !== 1) throw new Error("请先选择具体的一页图片");
    try {
      const info = await lstat(files[0]!.path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("图片位置已变化，请重新选择");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("找不到原图，请恢复原位置后重试");
      if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)) throw error;
      throw new Error("无法读取原图，请检查文件访问权限");
    }
    start(files[0]!.path);
  }
  async #run(s: Session) {
    for (let index = 0; index < s.files.length; index++) {
      const item = s.batch.items[index]!, file = s.files[index]!;
      if (item.status !== "pending") continue;
      if (s.batch.cancelRequested) { item.status = "cancelled"; continue; }
      let created: string | undefined;
      try {
        // Re-resolve on retry: deleted records and expired folder capabilities cannot be reused.
        const current = await this.resolveImages(s.owner, [file.target]);
        if (current.length !== 1 || current[0]!.path !== file.path) throw new Error("图片位置已变化，请重新选择");
        const hash = await fingerprintImage(file.path);
        if (s.batch.cancelRequested) { item.status = "cancelled"; continue; }
        if((await lstat(s.destination)).isSymbolicLink()||await realpath(s.destination)!==s.destination)throw new Error("目标文件夹已变化，请重新选择");
        const name = basename(file.fileName), extension = extname(name), stem = name.slice(0, name.length - extension.length);
        for (let suffix = 0; suffix < 1000; suffix++) {
          const candidate = join(s.destination, suffix ? `${stem} (${suffix + 1})${extension}` : name);
          try { await copyFile(file.path, candidate, constants.COPYFILE_EXCL); created = candidate; break; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        }
        if (!created) throw new Error("同名文件过多，请选择其他文件夹");
        if (await fingerprintImage(created) !== hash || await fingerprintImage(file.path) !== hash) throw new Error("复制校验未通过，原图可能正在修改，请重试");
        item.status = "copied"; item.fileName = basename(created); created = undefined;
      } catch (error) { item.status = "failed"; const code=(error as NodeJS.ErrnoException).code;item.error=code==="ENOENT"?"找不到原图或目标文件夹，请恢复后重试":code==="EACCES"||code==="EPERM"?"无法读写文件，请检查访问权限":error instanceof Error&&/[\u4e00-\u9fff]/.test(error.message)?error.message:"复制失败，请检查文件后重试"; }
      finally { if (created) await unlink(created).catch(() => undefined); s.touched = Date.now(); }
    }
    s.batch.phase = s.batch.cancelRequested ? "cancelled" : "completed";
  }
  #owned(owner: number, id: unknown): Session {
    this.#prune(); const s = typeof id === "string" ? this.#sessions.get(id) : undefined;
    if (!s || s.owner !== owner) throw new Error("复制记录已过期，请重新选择"); s.touched = Date.now(); return s;
  }
  #prune() {
    const finished = [...this.#sessions.values()].filter(s => s.batch.phase !== "running").sort((a,b) => b.touched-a.touched);
    for (const s of finished) if (Date.now()-s.touched > 30*60_000 || finished.indexOf(s) >= 8) this.#sessions.delete(s.batch.id);
  }
}
