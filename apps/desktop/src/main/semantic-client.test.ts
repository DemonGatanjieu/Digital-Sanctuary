import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SEMANTIC_VERSION, SemanticClient, SemanticVectorStore, validVector } from "./semantic-client";
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
    const client=new SemanticClient(join(tmpdir(),"missing-semantic-environment"));expect(client.availability().available).toBe(false);await expect(client.encode("query","夜晚")).rejects.toThrow("尚未准备");client.close();
  });
});
