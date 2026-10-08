import type { BrowserWindow, IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import { open } from "node:fs/promises";
import { clipboardImageSize } from "./clipboard-image-size.js";

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
  constructor(private store: Store, private host: GalleryBannerHost) {}
  get(): string | null {
    const value = this.store.getPreference<unknown>(KEY);
    return validBanner(value) ? value : null;
  }
  async choose(): Promise<string | null> {
    if (this.#busy) throw new Error("请先完成当前横幅选择");
    this.#busy = true;
    try {
      const path = await this.host.choose();
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
      const size = clipboardImageSize(bytes.subarray(0, 1024 * 1024));
      if (!size) throw new Error("请选择 JPG、PNG、WebP 或 GIF 图片");
      if (size.width * size.height > 32_000_000) throw new Error("图片尺寸过大，请选择小于 3,200 万像素的图片");
      const encoded = await this.host.encode(bytes);
      if (!validBanner(encoded)) throw new Error("横幅生成失败，请换一张图片重试");
      this.store.setPreference(KEY, encoded);
      return encoded;
    } catch (cause) {
      if (cause instanceof Error && /[\u4e00-\u9fff]/.test(cause.message)) throw cause;
      const code = (cause as NodeJS.ErrnoException).code;
      throw new Error(code === "ENOENT" ? "找不到这张图片，请重新选择" : code === "EACCES" || code === "EPERM" ? "无法读取这张图片，请检查访问权限" : "无法设置横幅，请换一张图片重试");
    } finally { this.#busy = false; }
  }
  reset(): null {
    if (this.#busy) throw new Error("请先完成当前横幅选择");
    this.store.setPreference(KEY, null);
    return null;
  }
}
function validBanner(value: unknown): value is string {
  return typeof value === "string" && value.length < MAX_DATA_URL && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value);
}

export function registerGalleryBannerIpc(ipc: Pick<IpcMain, "handle">, store: Store, getWindow: () => BrowserWindow | null) {
  const service = new GalleryBannerService(store, {
    async choose() {
      const { dialog } = await import("electron"), window = getWindow();
      const options = { title: "选择图库横幅", properties: ["openFile"] as ["openFile"], filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }] };
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
  });
  for (const [channel, action] of [["gallery:banner-get", () => service.get()], ["gallery:banner-choose", () => service.choose()], ["gallery:banner-reset", () => service.reset()]] as const) {
    ipc.handle(channel, event => {
      const window = getWindow();
      if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("请从图库设置横幅");
      return action();
    });
  }
}
