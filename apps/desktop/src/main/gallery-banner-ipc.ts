import type { BrowserWindow, IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import { open } from "node:fs/promises";
import { imageHeaderSize } from "./image-header-size.js";

const KEY = "library.banner.v1";
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_DATA_URL = 2_000_000;
type Store = Pick<LibraryDatabase, "getPreference" | "setPreference">;
export interface GalleryBannerHost {
  choose(): Promise<string | null>;
  encode(bytes: Buffer): Promise<string>;
}

/** Native-picked file becomes a bounded, owned bitmap; original paths never enter renderer preferences. */
export class GalleryBannerService {
  #busy = false;
  constructor(private store: Store, private host: GalleryBannerHost, private key=KEY,
    private resolveAsset?: (workId: string, assetId: string) => string | null) {}
  get(): string | null {
    const value = this.store.getPreference<unknown>(this.key);
    return validBanner(value) ? value : null;
  }
  async fromLibrary(value: unknown): Promise<string | null> {
    if(!value||typeof value!=="object")throw new Error("请从图库选择一张图片");
    const {workId,assetId}=value as Record<string,unknown>;
    if(typeof workId!=="string"||!workId||workId.length>300||typeof assetId!=="string"||!assetId||assetId.length>300)throw new Error("图库图片选择无效");
    return this.choose(async()=>{
      const path=this.resolveAsset?.(workId,assetId);
      if(!path)throw new Error("这张图片已不在图库中，请重新选择");
      return path;
    });
  }
  async choose(pick: () => Promise<string | null> = () => this.host.choose()): Promise<string | null> {
    if (this.#busy) throw new Error("请先完成当前图片选择");
    this.#busy = true;
    try {
      const path = await pick();
      if (!path) return this.get();
      const file = await open(path, "r");
      let bytes: Buffer;
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size <= 0 || info.size > MAX_BYTES) throw new Error("请选择小于 32 MB 的图片");
        // Read at most the checked size, even if another program grows the source concurrently.
        const buffer = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
          if (!bytesRead) throw new Error("图片正在变化，请重新选择");
          offset += bytesRead;
        }
        const after = await file.stat();
        if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error("图片正在变化，请重新选择");
        bytes = buffer;
      } finally { await file.close(); }
      const size = imageHeaderSize(bytes.subarray(0, 1024 * 1024));
      if (!size) throw new Error("请选择 JPG、PNG、WebP 或 GIF 图片");
      if (size.width * size.height > 32_000_000) throw new Error("图片尺寸过大，请选择小于 3,200 万像素的图片");
      const encoded = await this.host.encode(bytes);
      if (!validBanner(encoded)) throw new Error("图片生成失败，请换一张图片重试");
      this.store.setPreference(this.key, encoded);
      return encoded;
    } catch (cause) {
      if (cause instanceof Error && /[\u4e00-\u9fff]/.test(cause.message)) throw cause;
      const code = (cause as NodeJS.ErrnoException).code;
      throw new Error(code === "ENOENT" ? "找不到这张图片，请重新选择" : code === "EACCES" || code === "EPERM" ? "无法读取这张图片，请检查访问权限" : "无法设置图片，请换一张图片重试");
    } finally { this.#busy = false; }
  }
  reset(): null {
    if (this.#busy) throw new Error("请先完成当前图片选择");
    this.store.setPreference(this.key, null);
    return null;
  }
}
function validBanner(value: unknown): value is string {
  return typeof value === "string" && value.length < MAX_DATA_URL && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value);
}

export function registerGalleryBannerIpc(ipc: Pick<IpcMain, "handle">, store: Store & Pick<LibraryDatabase,"getWork">, getWindow: () => BrowserWindow | null) {
  for(const surface of ["gallery","home"] as const){
  const service = new GalleryBannerService(store, {
    async choose() {
      const { dialog } = await import("electron"), window = getWindow();
      const options = { title: surface==="gallery"?"选择图库横幅":"选择首页背景", properties: ["openFile"] as ["openFile"], filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }] };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return picked.canceled ? null : picked.filePaths[0] ?? null;
    },
    async encode(bytes) {
      await new Promise<void>(done => setImmediate(done));
      const { nativeImage } = await import("electron");
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error("无法打开这张图片，请换一张重试");
      const { width, height } = image.getSize();
      if (width * height > 32_000_000) throw new Error("图片尺寸过大，请换一张重试");
      const scale = Math.min(1, 1600 / width, 900 / height);
      const resized = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: "better" }) : image;
      return `data:image/jpeg;base64,${resized.toJPEG(85).toString("base64")}`;
    }
  },surface==="gallery"?KEY:"home.background.v1",(workId,assetId)=>{
    const asset=store.getWork(workId)?.assets.find(asset=>asset.id===assetId&&asset.mediaType==="image"&&asset.fileState==="available");
    return asset?.path??null;
  });
  const prefix=surface==="gallery"?"gallery:banner":"home:background";
  for (const [suffix, action] of [["get", () => service.get()], ["choose", () => service.choose()], ["reset", () => service.reset()], ["library", (value:unknown)=>service.fromLibrary(value)]] as const) {
    ipc.handle(`${prefix}-${suffix}`, (event,value:unknown) => {
      const window = getWindow();
      if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("请从应用内设置图片");
      return action(value);
    });
  }
  }
}
