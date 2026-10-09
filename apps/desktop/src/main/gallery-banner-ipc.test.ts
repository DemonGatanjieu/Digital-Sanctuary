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
  it("permits home background/drag IPC only from the local window's main frame", async () => {
    const store = new LibraryDatabase(":memory:"), handlers = new Map<string, (...args: any[]) => any>();
    const ipc = { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) } as Pick<IpcMain, "handle">;
    const sender = { id: 1, mainFrame: {}, startDrag: vi.fn(), isDestroyed: () => false }, window = { webContents: sender } as unknown as BrowserWindow;
    const output = { drag: vi.fn(async (_owner, _target, start) => start("trusted.png")) } as unknown as ImageOutputService;
    try {
      registerGalleryBannerIpc(ipc, store, () => window); registerImageDragIpc(ipc, output, () => window, {} as NativeImage);
      for (const channel of ["home:background-get", "home:background-choose", "home:background-reset", "home:background-library", "images:drag"]) {
        expect(() => handlers.get(channel)!({ sender: {}, senderFrame: sender.mainFrame }, {})).toThrow("请从");
        expect(() => handlers.get(channel)!({ sender, senderFrame: {} }, {})).toThrow("请从");
      }
      expect(handlers.get("home:background-get")!({ sender, senderFrame: sender.mainFrame })).toBeNull();
      expect(handlers.has("gallery:banner-get")).toBe(false);
      await handlers.get("images:drag")!({ sender, senderFrame: sender.mainFrame }, { workId: "x", assetId: "y" });
      expect(sender.startDrag).toHaveBeenCalledWith({ file: "trusted.png", icon: {} });
    } finally { store.close(); }
  });
  it("resolves a selected library page in main, keeps independent home/banner copies and preserves them on failure",async()=>{
    const root=await mkdtemp(join(tmpdir(),"sanctuary-library-background-")),store=new LibraryDatabase(":memory:"),path=join(root,"page.png");
    await writeFile(path,PNG);const art=store.importArtwork(path),work=store.getWork(`local:${art.id}`)!,asset=work.assets[0]!;
    const choose=vi.fn(async()=>null),encode=vi.fn(async()=>ENCODED),resolve=(workId:string,assetId:string)=>store.getWork(workId)?.assets.find(a=>a.id===assetId)?.path??null;
    const banner=new GalleryBannerService(store,{choose,encode},"library.banner.v1",resolve),home=new GalleryBannerService(store,{choose,encode},"home.background.v1",resolve);
    try{
      await banner.fromLibrary({workId:work.id,assetId:asset.id,path:"not-a-renderer-path"});expect(choose).not.toHaveBeenCalled();expect(encode).toHaveBeenCalledWith(PNG);
      encode.mockResolvedValueOnce("data:image/jpeg;base64,aG9tZQ==");await home.fromLibrary({workId:work.id,assetId:asset.id});
      expect(home.get()).not.toBe(banner.get());expect(banner.reset()).toBeNull();expect(home.get()).not.toBeNull();
      await expect(home.fromLibrary({workId:work.id,assetId:"not-a-member"})).rejects.toThrow("已不在图库");
      await expect(home.fromLibrary({path})).rejects.toThrow("选择无效");
      await rm(path);await expect(home.fromLibrary({workId:work.id,assetId:asset.id})).rejects.toThrow("找不到");expect(home.get()).toBe("data:image/jpeg;base64,aG9tZQ==");
    }finally{store.close();await rm(root,{recursive:true,force:true});}
  });
});
