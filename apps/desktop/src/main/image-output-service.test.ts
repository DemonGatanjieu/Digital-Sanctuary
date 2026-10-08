import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ImageOutputService, parseImageTargets, type ResolvedImage } from "./image-output-service";
import type { ImageExportBatch, ImageTarget } from "@sanctuary/domain";
const PNG=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
const cleanups:(()=>void)[]=[];
afterEach(()=>{cleanups.splice(0).forEach(f=>f());vi.restoreAllMocks();});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"sanctuary-output-test-")),destination=join(root,"out");mkdirSync(destination);
  const paths=new Map<string,string>();const copyImage=vi.fn(async()=>{}),reveal=vi.fn();
  cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
  const service=new ImageOutputService(async(owner,targets)=>{
    if(owner!==1)throw new Error("owner");
    return targets.map(target=>{const id="workId" in target?target.workId:target.itemId,path=paths.get(id);if(!path)throw new Error("图片已失效");return {path,target,fileName:"same.png"} as ResolvedImage;});
  },{chooseDirectory:async()=>destination,copyImage,reveal});
  const image=(id:string,bytes:Buffer|string=PNG)=>{const path=join(root,`${id}.png`);paths.set(`local:${id}`,path);writeFileSync(path,bytes);return {workId:`local:${id}`,assetId:`asset:${id}`};};
  return {root,destination,paths,service,image,copyImage,reveal};
}
async function finished(service:ImageOutputService,b:ImageExportBatch){
  for(let i=0;i<200;i++){const next=service.get(1,b.id);if(next.phase!=="running")return next;await new Promise(done=>setTimeout(done,5));}throw new Error("copy never finished");
}
describe("explicit original image output",()=>{
  it("drags only a reauthorized concrete file and leaves original bytes intact",async()=>{
    const f=fixture(),target=f.image("drag"),start=vi.fn();
    await f.service.drag(1,target,start);
    expect(start).toHaveBeenCalledWith(f.paths.get("local:drag"));
    expect(readFileSync(f.paths.get("local:drag")!)).toEqual(PNG);
    await expect(f.service.drag(1,{workId:target.workId},start)).rejects.toThrow("具体");
    await expect(f.service.drag(1,{path:f.paths.get("local:drag")},start)).rejects.toThrow("无效");
    await expect(f.service.drag(2,target,start)).rejects.toThrow("owner");
    rmSync(f.paths.get("local:drag")!);
    await expect(f.service.drag(1,target,start)).rejects.toThrow("找不到原图");
    expect(start).toHaveBeenCalledTimes(1);
  });
  it("preserves original bytes, existing files and colliding names",async()=>{
    const f=fixture(),a=f.image("a"),b=f.image("b",Buffer.concat([PNG,Buffer.from("second")]));
    writeFileSync(join(f.destination,"same.png"),"existing");
    const batch=await finished(f.service,(await f.service.start(1,[a,b]))!);
    expect(batch.items.map(i=>i.status)).toEqual(["copied","copied"]);
    expect(readFileSync(join(f.destination,"same.png"),"utf8")).toBe("existing");
    expect(readFileSync(join(f.destination,"same (2).png"))).toEqual(PNG);
    expect(readFileSync(join(f.destination,"same (3).png"))).toEqual(readFileSync(f.paths.get("local:b")!));
    expect(readFileSync(f.paths.get("local:a")!)).toEqual(PNG);
  });
  it("retries failures only and keeps successful exports",async()=>{
    const f=fixture(),a=f.image("a"),b=f.image("b","broken");
    let batch=await finished(f.service,(await f.service.start(1,[a,b]))!);
    expect(batch.items.map(i=>i.status)).toEqual(["copied","failed"]);expect(batch.items[1]!.error).toContain("图片");
    writeFileSync(f.paths.get("local:b")!,PNG);batch=await finished(f.service,f.service.retry(1,batch.id));
    expect(batch.items.every(i=>i.status==="copied")).toBe(true);expect(readdirSync(f.destination)).toHaveLength(2);
  });
  it("stops before the next file, resumes remaining items and isolates owners",async()=>{
    const f=fixture(),target=f.image("a"),batch=(await f.service.start(1,[target]))!;
    f.service.cancel(1,batch.id);const stopped=await finished(f.service,batch);
    expect(stopped.phase).toBe("cancelled");expect(stopped.items[0]!.status).toBe("cancelled");expect(readdirSync(f.destination)).toEqual([]);
    expect(()=>f.service.get(2,batch.id)).toThrow("过期");
    expect(f.service.tasks(2)).toEqual([]);expect(f.service.tasks(1)[0]).toMatchObject({kind:"copy",phase:"cancelled",total:1});expect(f.service.tasks(1)[0]).not.toHaveProperty("items");
    expect((await finished(f.service,f.service.retry(1,batch.id))).items[0]!.status).toBe("copied");
  });
  it("uses a concrete page for clipboard/reveal and a cancelled picker writes nothing",async()=>{
    const f=fixture(),target=f.image("a");await f.service.use(1,target,"copy");await f.service.use(1,target,"reveal");
    expect(f.copyImage).toHaveBeenCalledWith(f.paths.get("local:a"));expect(f.reveal).toHaveBeenCalledTimes(1);
    await expect(f.service.use(1,{workId:"local:a"},"copy")).rejects.toThrow("具体");
    const cancelled=new ImageOutputService(async()=>[{target,path:f.paths.get("local:a")!,fileName:"same.png"}],{chooseDirectory:async()=>null,copyImage:f.copyImage,reveal:f.reveal});
    expect(await cancelled.start(1,[target])).toBeNull();expect(readdirSync(f.destination)).toEqual([]);
  });
  it("rejects arbitrary paths, oversized selections and failed reauthorization",async()=>{
    expect(()=>parseImageTargets([{path:"C:/secret",destination:"C:/"}])).toThrow("无效");
    expect(()=>parseImageTargets(Array.from({length:501},()=>({workId:"local:x"})))).toThrow("500");
    const f=fixture(),target=f.image("a"),batch=(await f.service.start(1,[target]))!;
    f.service.cancel(1,batch.id);await finished(f.service,batch);f.paths.clear();
    const result=await finished(f.service,f.service.retry(1,batch.id));expect(result.items[0]!.status).toBe("failed");expect(readdirSync(f.destination)).toEqual([]);
  });
});
