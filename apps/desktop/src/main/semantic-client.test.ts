import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SEMANTIC_VERSION, SemanticClient, SemanticVectorStore, developmentSemanticRuntime, installedSemanticRuntime, validVector } from "./semantic-client";
function vector(){const v=Array<number>(768).fill(0);v[0]=1;return v;}
describe("offline semantic runtime and cache",()=>{
  it("persists content vectors and rejects stale versions or corrupt values",()=>{
    const root=mkdtempSync(join(tmpdir(),"semantic-cache-test-")),path=join(root,"index.db");let store=new SemanticVectorStore(path);
    try{
      store.put("hash",vector());store.close();store=new SemanticVectorStore(path);expect(store.get("hash")).toEqual(vector());
      expect(()=>store.put("bad",[1,2,3])).toThrow("向量");
      const raw=new DatabaseSync(path);raw.prepare("UPDATE vectors SET version=? WHERE hash=?").run("old-model","hash");expect(store.get("hash")).toBeNull();
      raw.prepare("INSERT INTO vectors VALUES(?,?,?,?)").run("corrupt",SEMANTIC_VERSION,"[]",Date.now());raw.close();expect(store.get("corrupt")).toBeNull();
    }finally{store.close();rmSync(root,{recursive:true,force:true});}
  });
  it("rejects non-finite, unnormalized or wrong-dimensional vectors",()=>{
    expect(validVector(vector())).toBe(true);expect(validVector(Array(768).fill(1))).toBe(false);const n=vector();n[1]=NaN;expect(validVector(n)).toBe(false);
  });
  it("reports absent optional models without spawning or downloading",async()=>{
    const missing=join(tmpdir(),"missing-semantic-environment");
    const client=new SemanticClient([installedSemanticRuntime(missing),developmentSemanticRuntime(missing)]);expect(client.availability().available).toBe(false);
    expect(client.availability().message).toContain("模型管理");await expect(client.encode("query","夜晚")).rejects.toThrow("先下载找图模型");client.close();
  });
  it("uses an installed runtime only when the worker, the verified snapshot and the install marker are all present",()=>{
    const root=mkdtempSync(join(tmpdir(),"semantic-installed-"));
    try{
      const runtime=installedSemanticRuntime(root);expect(runtime.args).toEqual([root]);
      mkdirSync(join(root,"sanctuary-semantic"));writeFileSync(runtime.command,"");writeFileSync(join(root,"sanctuary.manifest.json"),"{}");
      expect(new SemanticClient([runtime]).availability().available).toBe(false);
      writeFileSync(join(root,"sanctuary-model.json"),"{}");
      expect(new SemanticClient([runtime]).availability().available).toBe(true);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
