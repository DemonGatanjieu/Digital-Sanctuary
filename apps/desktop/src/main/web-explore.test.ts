import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryDatabase } from "@sanctuary/database";
import type { BrowserWindow } from "electron";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), lookup: vi.fn(), menu: vi.fn(), requests: null as null | ((...args: any[]) => void), handlers: new Map<string, (...args:any[])=>void>(), preferences: {} as Record<string,unknown> }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("electron", () => ({ Menu: { buildFromTemplate: mocks.menu }, WebContentsView: class {
  webContents = { session: { fetch: mocks.fetch, setPermissionCheckHandler:vi.fn(),setPermissionRequestHandler:vi.fn(),on:vi.fn(),webRequest:{onBeforeRequest:(_filter:unknown,callback:any)=>{mocks.requests=callback;}} }, on:(event:string,callback:any)=>mocks.handlers.set(event,callback),setWindowOpenHandler:vi.fn(),getURL:()=>"https://example.org/gallery",getTitle:()=>"参考站点",loadURL:vi.fn() };
  constructor(options:any) { mocks.preferences=options.webPreferences; }
  setVisible() {} setBackgroundColor() {}
} }));
import { WebExplore } from "./web-explore.js";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const cleanup: (()=>void)[]=[];
afterEach(()=>{cleanup.splice(0).forEach(fn=>fn());vi.clearAllMocks();});
function fixture() {
  const root=mkdtempSync(join(tmpdir(),"sanctuary-web-collect-")),db=new LibraryDatabase(":memory:");
  cleanup.push(()=>{db.close();rmSync(root,{recursive:true,force:true});});
  mocks.lookup.mockResolvedValue([{address:"93.184.216.34",family:4}]);
  const browser=new WebExplore({contentView:{addChildView:vi.fn()}} as unknown as BrowserWindow,db,()=>root,()=>{},()=>{},()=>true);
  return {browser,db};
}
describe("isolated web view and explicit image collection",()=>{
  it("has no preload or app bridge and denies protected Pixiv and local resources",()=>{
    fixture();expect(mocks.preferences).toMatchObject({sandbox:true,nodeIntegration:false,contextIsolation:true});expect(mocks.preferences).not.toHaveProperty("preload");
    for(const url of ["file:///C:/a.png","sanctuary-image://local/a","https://i.pximg.net/img-original/a.png","https://www.pixiv.net/"]) {
      const callback=vi.fn();mocks.requests!({url,resourceType:"image"},callback);expect(callback).toHaveBeenCalledWith({cancel:true});
    }
  });
  it("stores validated original bytes, managed ownership and provenance, then reuses an exact duplicate",async()=>{
    const {browser,db}=fixture();mocks.fetch.mockImplementation(()=>Promise.resolve(new Response(png,{headers:{"content-type":"image/png"}})));
    await browser.collect("https://cdn.example.org/original.png","https://example.org/gallery","天空参考");
    const work=db.listWorks()[0]!;expect(work).toMatchObject({ownership:"managed",title:"天空参考"});expect(readFileSync(work.assets[0]!.path)).toEqual(png);
    expect(db.getPreference(`web-source:${work.id}`)).toMatchObject({pageUrl:"https://example.org/gallery",imageUrl:"https://cdn.example.org/original.png"});
    await browser.collect("https://cdn.example.org/same.png","https://example.org/other","另一站");
    expect(db.listWorks()).toHaveLength(1);expect(browser.notice).toContain("已在图库");expect(db.listWorks()[0]!.title).toBe("天空参考");
  });
  it("rejects private redirects before fetching them and rejects disguised non-images",async()=>{
    const {browser,db}=fixture();mocks.fetch.mockResolvedValueOnce(new Response(null,{status:302,headers:{location:"http://127.0.0.1/secret"}}));
    await browser.collect("https://example.org/image","https://example.org/","test");expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(browser.error).toBeTruthy();expect(db.listWorks()).toHaveLength(0);
    mocks.fetch.mockResolvedValueOnce(new Response("<html>bad</html>",{headers:{"content-type":"image/png"}}));
    await browser.collect("https://example.org/image","https://example.org/","test");expect(browser.error).toContain("文件内容");expect(db.listWorks()).toHaveLength(0);
  });
  it("does not fetch blobs, private DNS destinations or oversized images",async()=>{
    const {browser,db}=fixture();await browser.collect("blob:https://example.org/id","https://example.org/","test");expect(browser.error).toContain("临时地址");expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.lookup.mockResolvedValueOnce([{address:"10.0.0.1",family:4}]);await browser.collect("https://example.org/image","https://example.org/","test");expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValueOnce(new Response(png,{headers:{"content-type":"image/png","content-length":String(33*1024*1024)}}));await browser.collect("https://example.org/image","https://example.org/","test");expect(browser.error).toContain("32 MB");expect(db.listWorks()).toHaveLength(0);
  });
});
