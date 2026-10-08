import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, writeFile, unlink, lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Menu, WebContentsView, type BrowserWindow } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import { fingerprintImage } from "./local-import-service.js";
import { isAllowedPixivNavigation } from "./explore-policy.js";
import { publicWebUrl, isPrivateAddress } from "./web-explore-policy.js";

/** Remote pages have no preload, app IPC, file protocol or automatic import capability. */
export class WebExplore {
  view: WebContentsView;
  error = "";
  notice = "";
  saving = false;
  requestedUrl = "";
  #navigation = 0;
  constructor(window: BrowserWindow, private database: LibraryDatabase, private directory: () => string,
    private changed: () => void, private openPixiv: (url: string) => void, private isActive: () => boolean) {
    this.view = new WebContentsView({ webPreferences: { partition: "persist:explore-web", sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false } });
    window.contentView.addChildView(this.view); this.view.setVisible(false); this.view.setBackgroundColor("#ffffff");
    const c = this.view.webContents, s = c.session;
    s.setPermissionCheckHandler(() => false); s.setPermissionRequestHandler((_c,_p,callback) => callback(false));
    s.on("will-download", event => event.preventDefault());
    s.webRequest.onBeforeRequest({ urls: ["*://*/*", "file://*/*", "sanctuary-image://*/*"] }, (details, callback) => {
      let blocked = false;
      try {
        const url = new URL(publicWebUrl(details.url));
        blocked = isAllowedPixivNavigation(url.href) || url.hostname === "pximg.net" || url.hostname.endsWith(".pximg.net");
        if (blocked && details.resourceType === "mainFrame" && isAllowedPixivNavigation(url.href)) this.openPixiv(url.href);
      } catch { blocked = true; }
      callback({ cancel: blocked });
    });
    const navigate = (event: Electron.Event & { url: string; isMainFrame: boolean }) => {
      try {
        publicWebUrl(event.url);
        if (isAllowedPixivNavigation(event.url)) { event.preventDefault(); if (event.isMainFrame) this.openPixiv(event.url); }
      } catch (error) { event.preventDefault(); this.error = human(error); this.changed(); }
    };
    c.on("will-navigate", navigate); c.on("will-redirect", navigate);
    c.setWindowOpenHandler(({url}) => { void this.open(url); return { action: "deny" }; });
    c.on("did-start-loading", () => this.changed()); c.on("did-stop-loading", () => this.changed());
    c.on("did-navigate", () => this.changed()); c.on("did-navigate-in-page", () => this.changed()); c.on("page-title-updated", () => this.changed());
    c.on("did-fail-load", (_event,code,description,_url,main) => { if (main && code !== -3) { this.error = `页面加载失败：${description}`; this.changed(); } });
    c.on("before-input-event", (event,input) => { if (input.type === "keyDown" && (input.control || input.meta) && input.key.toLowerCase() === "k") { event.preventDefault(); window.webContents.focus(); window.webContents.send("app:quick-actions"); } });
    c.on("context-menu", (_event,params) => {
      if (!this.isActive() || !params.hasImageContents) return;
      const pageUrl = c.getURL(), title = c.getTitle(), imageUrl = params.srcURL;
      Menu.buildFromTemplate([{ label: this.saving ? "正在收图…" : "加入图库", enabled: !this.saving,
        click: () => { void this.collect(imageUrl, pageUrl, title); } }]).popup({ window });
    });
  }
  async open(url: string) {
    const navigation = ++this.#navigation;
    try {
      const safe = publicWebUrl(url);
      if (isAllowedPixivNavigation(safe)) { this.openPixiv(safe); return; }
      this.requestedUrl = safe; this.error = ""; this.notice = ""; this.changed();
      await this.view.webContents.loadURL(safe);
    } catch (error) { if (navigation === this.#navigation) { this.error = human(error); this.changed(); } }
  }
  async collect(imageValue: string, pageValue: string, title: string) {
    if (this.saving) return;
    this.saving = true; this.error = ""; this.notice = "正在将图片保存到图库…"; this.changed();
    let path: string | undefined;
    try {
      const pageUrl = publicWebUrl(pageValue);
      let imageUrl: string;
      try { imageUrl = publicWebUrl(imageValue); } catch { throw new Error("这张图使用临时地址，暂不能直接收图。请先在网站下载，再导入本地图片。"); }
      const signal = AbortSignal.timeout(30_000);
      let response: Response | undefined;
      for (let hop = 0; hop < 6; hop++) {
        const url = new URL(publicWebUrl(imageUrl));
        if (isAllowedPixivNavigation(url.href) || url.hostname.endsWith(".pximg.net")) throw new Error("请在 Pixiv 探索中使用作品下载，以保留作品信息和保护规则");
        const addresses = await withAbort(() => lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true }), signal);
        if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw new Error("图片地址指向本地网络，无法收图");
        response = await this.view.webContents.session.fetch(url.href, { redirect: "manual", signal, headers: { Referer: `${new URL(pageUrl).origin}/` } });
        if (![301,302,303,307,308].includes(response.status)) break;
        const location = response.headers.get("location"); await response.body?.cancel();
        if (!location || hop === 5) throw new Error("图片重定向过多，请先下载再导入");
        imageUrl = publicWebUrl(new URL(location, url).href);
      }
      if (!response?.ok || !response.body) throw new Error(`网站未允许读取图片（${response?.status ?? "网络异常"}），请先下载再导入`);
      const mime = response.headers.get("content-type")?.split(";")[0]?.trim();
      const extension = ({ "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/gif":"gif", "image/avif":"avif" } as Record<string,string>)[mime ?? ""];
      if (!extension) { await response.body.cancel(); throw new Error("这个地址没有返回支持的原图，请在图片本身右键收图"); }
      const limit = 32 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > limit) { await response.body.cancel(); throw new Error("图片超过 32 MB，请先下载再导入"); }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > limit) throw new Error("图片超过 32 MB，请先下载再导入"); chunks.push(chunk.value); } }
      finally { await reader.cancel().catch(() => undefined); }
      let root = resolve(this.directory()); await mkdir(root, { recursive: true });
      if ((await lstat(root)).isSymbolicLink()) throw new Error("图库目录被重定向，请检查保存位置");
      root = await realpath(root);
      path = join(root, `${randomUUID()}.${extension}`); await writeFile(path, Buffer.concat(chunks), { flag: "wx" });
      const hash = await fingerprintImage(path), match = this.database.findLocalImportMatch(path, hash, "managed");
      const verified = match && await fingerprintImage(match.path).catch(() => null) === hash ? match : null;
      this.database.commitLocalImport(verified?.path ?? path, hash, null, verified?.artworkId, "managed", { pageUrl, imageUrl: imageValue, title: title.slice(0,200), savedAt: new Date().toISOString() });
      if (verified) await unlink(path); else path = undefined;
      this.notice = verified ? "这张图片已在图库，可直接使用" : "已加入图库，原图与来源页面已保存";
    } catch (error) { this.notice = ""; this.error = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "收图超过 30 秒，请检查网络后重试，或先下载再导入" : human(error); }
    finally { if (path) await unlink(path).catch(() => undefined); this.saving = false; this.changed(); }
  }
}
function human(error: unknown) { return error instanceof Error ? error.message : "操作失败，请重试"; }
async function withAbort<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let stop: () => void = () => undefined;
  try {
    return await Promise.race([task(), new Promise<never>((_resolve,reject) => {
      stop = () => reject(signal.reason); signal.addEventListener("abort", stop, {once:true});
    })]);
  } finally { signal.removeEventListener("abort", stop); }
}
