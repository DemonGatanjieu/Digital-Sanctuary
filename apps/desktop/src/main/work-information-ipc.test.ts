import { describe, expect, it } from "vitest";
import { LibraryDatabase } from "@sanctuary/database";
import { registerWorkInformationIpc } from "./work-information-ipc";
import type { IpcMain } from "electron";
import type { WorkInformation } from "@sanctuary/domain";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintImage } from "./local-import-service.js";

describe("stored work information", () => {
  it("relinks by a native picker while preserving identity, albums, name and known analysis",async()=>{
    const root=mkdtempSync(join(tmpdir(),"sanctuary-relink-")),database=new LibraryDatabase(":memory:");
    const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64"),path=join(root,"original.png"),moved=join(root,"moved.png");
    writeFileSync(path,png);writeFileSync(moved,png);
    try {
      const hash=await fingerprintImage(path),id=database.commitLocalImport(path,hash,null),workId=database.workIdForArtwork(id)!,work=database.getWork(workId)!,album=database.createCollection("参考");
      database.addWorkToCollection(workId,album.id);database.renameWork(workId,"保留的名称");
      const assessment={engine:"test",engineVersion:"1",elapsedMs:1,status:"complete" as const,labels:{sky:.9}};database.saveAssessment(id,assessment,{action:"allow",reasons:[],decidedAt:new Date().toISOString()});
      const sender={mainFrame:{}},event={sender,senderFrame:sender.mainFrame},window={webContents:sender};
      const handlers=new Map<string,(...args:any[])=>any>();
      registerWorkInformationIpc({handle:(channel:string,handler:any)=>handlers.set(channel,handler)} as unknown as IpcMain,database,{showOpenDialog:async()=>({canceled:false,filePaths:[moved]})} as any,()=>window as any);
      const relink=handlers.get("library:relink-external")!;
      await expect(relink({...event,senderFrame:{}},workId,work.assets[0]!.id)).rejects.toThrow("请从图库");
      const updated=await relink(event,workId,work.assets[0]!.id);
      expect(updated).toMatchObject({id:workId,title:"保留的名称",ownership:"external",collectionIds:[album.id],assets:[{id:work.assets[0]!.id,path:moved,contentHash:hash}]});
      expect(database.listArtworks()[0]!.assessment).toEqual(assessment);
      writeFileSync(moved,Buffer.concat([png,Buffer.from("another image")]));
      await expect(relink(event,workId,work.assets[0]!.id)).rejects.toThrow("内容不同");
    } finally {database.close();rmSync(root,{recursive:true,force:true});}
  });
  it("reads only the requested work/page, preserves metadata and never starts analysis", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      const first = database.importArtwork("E:/fixture/first.png");
      const second = database.importArtwork("E:/fixture/second.png");
      const album = database.createCollection("资料相册");
      database.addArtworkToCollection(first.id, album.id);
      const assessment = { status: "complete" as const, engine: "historical", engineVersion: "1", elapsedMs: 5, labels: { cat: .9 } };
      database.saveAssessment(first.id, assessment, { action: "allow", reasons: [], decidedAt: new Date().toISOString() });
      const handlers = new Map<string, (...args: unknown[]) => unknown>();
      registerWorkInformationIpc({ handle: (channel, handler) => handlers.set(channel, handler as (...args: unknown[]) => unknown) } as Pick<IpcMain, "handle">, database);
      const read = handlers.get("library:work-information")!;
      const result = read({}, `local:${first.id}`, 0) as WorkInformation;
      expect(result.assessment).toEqual(assessment);
      expect(result.work.collectionIds).toEqual([album.id]); expect(result.evaluations).toEqual([]); expect(result.provenance).toBeNull();
      expect(database.listAnalysisJobs()).toEqual([]);
      const asset = result.work.assets[0]!;
      expect(database.getStoredAssetAssessment(`local:${second.id}`, asset.id)).toBeNull();
      expect((read({}, `local:${first.id}`, 99) as WorkInformation).assessment).toBeNull();
      database.removeWorkFromIndex(result.work.id);
      expect(read({}, result.work.id, 0)).toBeNull();
      expect(database.getStoredAssetAssessment(result.work.id, asset.id)).toBeNull();
    } finally { database.close(); }
  });
  it("rejects malformed page requests before querying", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      let read!: (...args: unknown[]) => unknown;
      registerWorkInformationIpc({ handle: (channel, handler) => { if (channel === "library:work-information") read = handler as (...args: unknown[]) => unknown; } } as Pick<IpcMain, "handle">, database);
      expect(() => read({}, "local:x", -1)).toThrow("无效");
      expect(() => read({}, "local:x", 1.5)).toThrow("无效");
      expect(() => read({}, { path: "arbitrary" }, 0)).toThrow("无效");
    } finally { database.close(); }
  });
  it("accepts only a work ID and a display name, with no filesystem request", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      const image = database.importArtwork("E:/fixture/original.png");
      let rename!: (...args: unknown[]) => unknown;
      registerWorkInformationIpc({ handle: (channel, handler) => { if (channel === "library:rename-work") rename = handler as (...args: unknown[]) => unknown; } } as Pick<IpcMain, "handle">, database);
      expect(() => rename({}, { path: "arbitrary" }, "name")).toThrow("无效");
      expect(() => rename({}, `local:${image.id}`, { path: "arbitrary" })).toThrow("无效");
      expect(rename({}, `local:${image.id}`, "我的参考图")).toMatchObject({ title: "我的参考图", assets: [{ path: "E:/fixture/original.png" }] });
    } finally { database.close(); }
  });
});
