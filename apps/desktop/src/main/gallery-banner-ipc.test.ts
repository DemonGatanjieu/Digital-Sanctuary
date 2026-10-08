import { describe, expect, it, vi } from "vitest";
import { LibraryDatabase } from "@sanctuary/database";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GalleryBannerService, registerGalleryBannerIpc } from "./gallery-banner-ipc";
import { registerImageDragIpc } from "./image-drag-ipc";
import type { IpcMain, BrowserWindow, NativeImage } from "electron";
import type { ImageOutputService } from "./image-output-service";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const ENCODED = "data:image/jpeg;base64,YmFubmVy";
describe("owned gallery banner", () => {
  it("persists its own bitmap, keeps it after source removal, and preserves it on cancel/failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "sanctuary-banner-")), store = new LibraryDatabase(":memory:"), path = join(root, "source.png");
    const choose = vi.fn(async (): Promise<string | null> => path), encode = vi.fn(async () => ENCODED);
    const service = new GalleryBannerService(store, { choose, encode });
    try {
      await writeFile(path, PNG); expect(await service.choose()).toBe(ENCODED);
      expect(encode).toHaveBeenCalledWith(PNG);
      await rm(path); expect(new GalleryBannerService(store, { choose, encode }).get()).toBe(ENCODED);
      choose.mockResolvedValueOnce(null); expect(await service.choose()).toBe(ENCODED);
      await expect(service.choose()).rejects.toThrow("找不到这张图片"); expect(service.get()).toBe(ENCODED);
      await writeFile(path, "not an image"); await expect(service.choose()).rejects.toThrow("JPG"); expect(service.get()).toBe(ENCODED);
      const oversized = Buffer.from(PNG); oversized.writeUInt32BE(100_000, 16); oversized.writeUInt32BE(100_000, 20);
      await writeFile(path, oversized); await expect(service.choose()).rejects.toThrow("尺寸过大"); expect(encode).toHaveBeenCalledTimes(1);
      await writeFile(path, PNG); encode.mockResolvedValueOnce("https://untrusted/image"); await expect(service.choose()).rejects.toThrow("生成失败"); expect(service.get()).toBe(ENCODED);
      expect(service.reset()).toBeNull(); expect(service.get()).toBeNull();
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });
  it("serializes picker/reset, and rejects unbounded or non-bitmap stored values", async () => {
    const store = new LibraryDatabase(":memory:"); let finish!: (path: null) => void;
    const service = new GalleryBannerService(store, { choose: () => new Promise(resolve => { finish = resolve; }), encode: async () => ENCODED });
    try {
      for (const value of ["file:///secret", "data:image/svg+xml;base64,YQ==", `data:image/jpeg;base64,${"a".repeat(2_000_000)}`]) {
        store.setPreference("library.banner.v1", value); expect(service.get()).toBeNull();
      }
      const pending = service.choose(); await expect(service.choose()).rejects.toThrow("请先"); expect(() => service.reset()).toThrow("请先");
      finish(null); expect(await pending).toBeNull();
    } finally { store.close(); }
  });
  it("permits banner/drag IPC only from the local window's main frame", async () => {
    const store = new LibraryDatabase(":memory:"), handlers = new Map<string, (...args: any[]) => any>();
    const ipc = { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) } as Pick<IpcMain, "handle">;
    const sender = { id: 1, mainFrame: {}, startDrag: vi.fn(), isDestroyed: () => false }, window = { webContents: sender } as unknown as BrowserWindow;
    const output = { drag: vi.fn(async (_owner, _target, start) => start("trusted.png")) } as unknown as ImageOutputService;
    try {
      registerGalleryBannerIpc(ipc, store, () => window); registerImageDragIpc(ipc, output, () => window, {} as NativeImage);
      for (const channel of ["gallery:banner-get", "gallery:banner-choose", "gallery:banner-reset", "images:drag"]) {
        expect(() => handlers.get(channel)!({ sender: {}, senderFrame: sender.mainFrame }, {})).toThrow("请从");
        expect(() => handlers.get(channel)!({ sender, senderFrame: {} }, {})).toThrow("请从");
      }
      expect(handlers.get("gallery:banner-get")!({ sender, senderFrame: sender.mainFrame })).toBeNull();
      await handlers.get("images:drag")!({ sender, senderFrame: sender.mainFrame }, { workId: "x", assetId: "y" });
      expect(sender.startDrag).toHaveBeenCalledWith({ file: "trusted.png", icon: {} });
    } finally { store.close(); }
  });
});
