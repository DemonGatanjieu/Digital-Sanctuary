import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { LibraryDatabase } from "@sanctuary/database";
import type { VisionAssessment, WorkbenchSnapshot } from "@sanctuary/domain";
import { GALLERY_SEARCH_MIN_SIMILARITY, ImageWorkbenchService, parseWorkbenchQuery } from "./image-workbench-service";
import { LocalImportService } from "./local-import-service";
import { SemanticVectorStore, validVector } from "./semantic-client";
import { ImageOutputService } from "./image-output-service";
const PNG=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
const cleanups:(()=>void)[]=[];
afterEach(()=>{cleanups.splice(0).forEach(f=>f());vi.restoreAllMocks();});
function vector(index:number){const v=Array<number>(768).fill(0);v[index]=1;return v;}
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"sanctuary-workbench-test-")),folder=join(root,"images");mkdirSync(folder);
  const database=new LibraryDatabase(":memory:"),importer=new LocalImportService(database),vectors=new SemanticVectorStore(join(root,"vectors.db"));
  let model="fixture:1";
  const classify=vi.fn(async(path:string):Promise<VisionAssessment>=>({status:"complete",engine:"fixture",engineVersion:"1",elapsedMs:1,labels:basename(path).startsWith("night")?{blood:.9,night:.9}:{sky:.9}}));
  const encode=vi.fn(async(kind:"image"|"query",value:string)=>vector(kind==="query"||value.includes("night")?1:0));
  const semantic={availability:()=>({available:true,model:"test",device:"cpu" as const,message:"test"}),encode,close:vi.fn()};
  const ready=vi.fn(()=>true);
  const service=new ImageWorkbenchService(database,{ready,identity:()=>model,classify,rules:()=>[{id:"blood",name:"血迹",label:"blood",enabled:true,minimumConfidence:.7,action:"hide",priority:1}]},semantic,vectors,importer);
  cleanups.push(()=>{service.close();vectors.close();database.close();rmSync(root,{recursive:true,force:true});});
  const image=(name:string,dir=folder,content:Buffer|string=Buffer.concat([PNG,Buffer.from(name)]))=>{const path=join(dir,name);writeFileSync(path,content);return path;};
  return {root,folder,database,importer,vectors,service,image,classify,encode,semantic,ready,setModel:(v:string)=>{model=v;}};
}
async function settled(service:ImageWorkbenchService,s:WorkbenchSnapshot){
  for(let i=0;i<300;i++){const n=service.get(1,s.id,0,"all");if(!["scanning","analyzing"].includes(n.phase))return n;await new Promise(done=>setTimeout(done,5));}throw new Error("workbench never settled");
}
const rules={mode:"rules",text:"",include:[],exclude:[]};
const description={mode:"description",text:"夜晚的月亮",include:[],exclude:[]};
describe("authorized image workbench",()=>{
  it("scans without importing or analyzing, isolates capabilities and prepares selected-only import",async()=>{
    const f=fixture();f.image("day.png");const sub=join(f.folder,"sub");mkdirSync(sub);f.image("night.png",sub);f.image("notes.txt");
    const s=await settled(f.service,f.service.chooseFolder(1,f.folder,false));expect(s.total).toBe(1);expect(f.classify).not.toHaveBeenCalled();expect(f.database.queryWorks({}).total).toBe(0);
    expect(()=>f.service.get(2,s.id)).toThrow("过期");expect(await f.service.preview(s.items[0]!.previewUrl)).toBe(realpathSync.native(join(f.folder,"day.png")));
    expect(f.service.tasks(2)).toEqual([]);expect(f.service.tasks(1)[0]).toMatchObject({kind:"workbench",source:"folder",total:1,phase:"ready"});expect(f.service.tasks(1)[0]).not.toHaveProperty("items");
    expect(await f.service.preview(`sanctuary-image://workbench/${s.id}/../../secret`)).toBeNull();
    const batch=await f.service.prepareImport(1,s.id,[s.items[0]!.id]);expect(batch!.items).toHaveLength(1);expect(f.database.queryWorks({}).total).toBe(0);
    f.importer.start(1,batch!.id,{collectionId:null,duplicatePolicy:"reuse"});
    for(let i=0;i<100&&f.importer.get(1,batch!.id).phase==="running";i++)await new Promise(done=>setTimeout(done,5));
    expect(f.database.queryWorks({}).total).toBe(1);expect(f.classify).not.toHaveBeenCalled();
    const recursive=await settled(f.service,f.service.chooseFolder(1,f.folder,true));expect(recursive.total).toBe(2);expect(await f.service.preview(s.items[0]!.previewUrl)).toBeNull();
  });
  it("applies exploration rules, excludes only successfully analyzed images and invalidates changed content/model",async()=>{
    const f=fixture();f.image("day.png");f.image("night.png");f.image("broken.png",f.folder,"not image");
    const s=await settled(f.service,f.service.chooseFolder(1,f.folder,false));
    let result=await settled(f.service,f.service.start(1,s.id,rules));expect(result.failed).toBe(1);expect(result.matched).toBe(1);expect(f.service.get(1,s.id).items[0]!.fileName).toBe("night.png");
    result=await settled(f.service,f.service.start(1,s.id,{mode:"elements",text:"",include:[],exclude:["blood"]}));
    expect(result.matched).toBe(1);expect(f.service.get(1,s.id).items[0]!.fileName).toBe("day.png");expect(f.classify).toHaveBeenCalledTimes(2);
    f.image("day.png",f.folder,Buffer.concat([PNG,Buffer.from("changed")]));
    await settled(f.service,f.service.start(1,s.id,rules));expect(f.classify).toHaveBeenCalledTimes(3);
    f.setModel("fixture:2");await settled(f.service,f.service.start(1,s.id,rules));expect(f.classify).toHaveBeenCalledTimes(5);
    expect(f.database.queryWorks({}).total).toBe(0);
  });
  it("ranks descriptions by normalized content vectors and reuses persistent cache without WD",async()=>{
    const f=fixture();f.image("day.png");f.image("night.png");const s=await settled(f.service,f.service.chooseFolder(1,f.folder,false));
    await settled(f.service,f.service.start(1,s.id,description));expect(f.service.get(1,s.id).items[0]!.fileName).toBe("night.png");expect(f.classify).not.toHaveBeenCalled();expect(f.encode).toHaveBeenCalledTimes(3);
    await settled(f.service,f.service.start(1,s.id,{...description,text:"另一句夜晚描述"}));expect(f.encode).toHaveBeenCalledTimes(4);
    const cache=new SemanticVectorStore(join(f.root,"vectors.db"));expect(validVector(cache.get("unknown"))).toBe(false);cache.close();
    f.image("day.png",f.folder,Buffer.concat([PNG,Buffer.from("new pixels")]));await settled(f.service,f.service.start(1,s.id,description));expect(f.encode).toHaveBeenCalledTimes(6);
    const combined=await settled(f.service,f.service.start(1,s.id,{...description,exclude:["blood"]}));expect(combined.matched).toBe(0);expect(f.service.get(1,s.id).items).toEqual([]);
    expect(f.service.get(1,s.id,0,"all").items).toHaveLength(2);
  });
  it("cancels an in-flight job without converting unprocessed images into negative matches",async()=>{
    const f=fixture();f.image("day.png");let release!:(value:VisionAssessment)=>void;
    f.classify.mockImplementationOnce(()=>new Promise(done=>{release=done;}));const s=await settled(f.service,f.service.chooseFolder(1,f.folder,false));
    f.service.start(1,s.id,rules);for(let i=0;i<100&&!release;i++)await new Promise(done=>setTimeout(done,5));
    expect(()=>f.service.chooseFolder(1,f.folder,false)).toThrow("停止");f.service.cancel(1,s.id);release({status:"complete",engine:"fixture",engineVersion:"1",labels:{blood:.9},elapsedMs:1});
    const result=await settled(f.service,s);expect(result.phase).toBe("cancelled");expect(result.matched).toBe(0);expect(result.unanalysed).toBe(1);
  });
  it("keeps library scope and page-level album assignment exact",async()=>{
    const f=fixture(),first=f.database.importArtwork(f.image("day.png")),second=f.database.importArtwork(f.image("night.png"));
    const album=f.database.createCollection("所选页");f.database.addArtworkToCollection(first.id,album.id);
    let s=await settled(f.service,f.service.chooseLibrary(1,{type:"collection",collectionId:album.id}));expect(s.total).toBe(1);
    s=await settled(f.service,f.service.chooseLibrary(1,{type:"selected",workIds:[`local:${second.id}`]}));expect(s.items[0]!.fileName).toBe("night.png");
    expect(f.service.assign(1,s.id,[s.items[0]!.id],album.id)).toBe(1);expect(f.database.getWork(`local:${second.id}`)!.collectionIds).toContain(album.id);
    expect(()=>f.service.assign(1,s.id,["made-up"],album.id)).toThrow("失效");
  });
  it("reports missing indexed pages as export failures instead of silently dropping them",async()=>{
    const f=fixture(),path=f.image("missing.png"),art=f.database.importArtwork(path),destination=join(f.root,"export");mkdirSync(destination);rmSync(path);
    const service=new ImageOutputService((owner,targets)=>f.service.resolveImages(owner,targets),{chooseDirectory:async()=>destination,copyImage:async()=>{},reveal:()=>{}});
    const batch=(await service.start(1,[{workId:`local:${art.id}`}]))!;
    for(let i=0;i<100&&service.get(1,batch.id).phase==="running";i++)await new Promise(done=>setTimeout(done,5));
    expect(service.get(1,batch.id).items).toEqual([expect.objectContaining({fileName:"missing.png",status:"failed"})]);
  });
  it("invalidates an assessment if pixels change during a combined cached-vector query",async()=>{
    const f=fixture(),path=f.image("day.png"),s=await settled(f.service,f.service.chooseFolder(1,f.folder,false));
    await settled(f.service,f.service.start(1,s.id,description));
    f.classify.mockImplementationOnce(async()=>{writeFileSync(path,Buffer.concat([PNG,Buffer.from("changed during analysis")]));return {status:"complete",engine:"fixture",engineVersion:"1",elapsedMs:1,labels:{sky:.9}};});
    const result=await settled(f.service,f.service.start(1,s.id,{...description,include:["sky"]}));expect(result.failed).toBe(1);expect(result.matched).toBe(0);
    const retry=await settled(f.service,f.service.start(1,s.id,{...description,include:["sky"]}));expect(retry.matched).toBe(0);expect(f.service.get(1,s.id,0,"all").items[0]?.matchedTags).toEqual(["sky"]);expect(f.classify).toHaveBeenCalledTimes(2);
  });
  it("bounds folder manifests and reports incomplete scans",async()=>{
    const f=fixture();for(let i=0;i<1001;i++)f.image(`${i}.png`);
    const s=await settled(f.service,f.service.chooseFolder(1,f.folder,false));expect(s.total).toBe(1000);expect(s.limitReached).toBe(true);expect(s.warnings.join()).toContain("未扫描完");
    expect(s.items).toHaveLength(60);expect(f.service.get(1,s.id,960,"all").items).toHaveLength(40);expect(()=>f.service.get(1,s.id,-1)).toThrow("分页");
  });
  it("skips directory links and rejects a parent replaced with a junction",async()=>{
    const f=fixture(),outside=join(f.root,"outside"),inside=join(f.folder,"inside");mkdirSync(outside);mkdirSync(inside);f.image("private.png",outside);f.image("day.png",inside);
    symlinkSync(outside,join(f.folder,"linked"),"junction");
    const s=await settled(f.service,f.service.chooseFolder(1,f.folder,true));expect(s.total).toBe(1);
    rmSync(inside,{recursive:true});symlinkSync(outside,inside,"junction");expect(await f.service.preview(s.items[0]!.previewUrl)).toBeNull();
    await expect(f.service.prepareImport(1,s.id,[s.items[0]!.id])).rejects.toThrow("链接");
  });
  it("requires real element inference and never treats a filename probe as an exclusion result",async()=>{
    const f=fixture();f.image("day.png");const s=await settled(f.service,f.service.chooseFolder(1,f.folder,false));f.ready.mockReturnValue(false);
    expect(()=>f.service.start(1,s.id,rules)).toThrow("尚未就绪");expect(f.classify).not.toHaveBeenCalled();
    expect((await settled(f.service,f.service.start(1,s.id,description))).matched).toBe(0);
    f.ready.mockReturnValue(true);f.classify.mockResolvedValueOnce({status:"complete",engine:"filename-probe",engineVersion:"0.1.0",elapsedMs:1,labels:{safe:.9}});
    const result=await settled(f.service,f.service.start(1,s.id,{mode:"elements",text:"",include:[],exclude:["blood"]}));expect(result.failed).toBe(1);expect(result.matched).toBe(0);
  });
  it("validates queries and optional model availability before starting",async()=>{
    expect(()=>parseWorkbenchQuery({...description,include:["sky"],exclude:["sky"]})).toThrow("同时");expect(()=>parseWorkbenchQuery({...description,text:""})).toThrow("描述");expect(()=>parseWorkbenchQuery({...rules,include:["../path"]})).toThrow("条件");
    const f=fixture();f.image("day.png");const s=await settled(f.service,f.service.chooseFolder(1,f.folder,false));vi.spyOn(f.semantic,"availability").mockReturnValue({available:false,model:"test",device:"cpu",message:"模型未准备"});
    expect(()=>f.service.start(1,s.id,description)).toThrow("未准备");expect(f.service.get(1,s.id,0,"all").phase).toBe("ready");
  });
});

async function gallerySettled(f: ReturnType<typeof fixture>,id: string) {
  for(let i=0;i<3000;i++){const result=f.service.galleryResults(1,id);if(!["scanning","analyzing"].includes(result.progress.phase))return result;await new Promise(done=>setTimeout(done,5));}
  throw new Error("gallery search did not settle");
}
describe("one-step gallery picture search",()=>{
  it("automatically scans and indexes every page, ranks a work by its best page and reuses the existing content cache",async()=>{
    const f=fixture();
    const pages=[f.database.importArtwork(f.image("day.png")),f.database.importArtwork(f.image("night.png"))];
    pages.forEach((art,index)=>f.database.saveArtworkSource(art.id,{platform:"pixiv",workId:"123",pageIndex:index,authorId:"456",authorName:"画师",title:"双页作品"}));
    f.ready.mockReturnValue(false);
    const started=f.service.searchGallery(1,"夜晚的月亮",{}),result=await gallerySettled(f,started.progress.id);
    expect(result.progress).toMatchObject({phase:"completed",processed:2,total:2});
    expect(result.result).toMatchObject({total:1,totalPages:1});
    expect(result.relevance).toMatchObject({mode:"relevant",hiddenWorks:0,hiddenPages:1});
    expect(f.service.galleryResults(1,started.progress.id,0,"all").result.totalPages).toBe(2);
    expect(result.result.items[0]).toMatchObject({id:"pixiv:123",matchedPage:1,coverAsset:{pageIndex:1,path:pages[1]!.path}});
    expect(f.classify).not.toHaveBeenCalled();expect(f.encode).toHaveBeenCalledTimes(3);
    expect(f.service.current(1,"library")).toBeNull();expect(f.service.tasks(1)[0]).toMatchObject({gallerySearch:true});
    const next=f.service.searchGallery(1,"另一个夜晚描述",{});await gallerySettled(f,next.progress.id);expect(f.encode).toHaveBeenCalledTimes(4);
    expect(()=>f.service.galleryResults(2,next.progress.id)).toThrow("过期");
  });
  it("shares ownership, favorite and album filters and does not accidentally use the description as a title filter",async()=>{
    const f=fixture(),a=f.database.importArtwork(f.image("day.png")),b=f.database.importArtwork(f.image("night.png"));
    const album=f.database.createCollection("外部收藏");f.database.addArtworkToCollection(b.id,album.id);f.database.updateWorkFavorite([`local:${b.id}`],true);
    f.database.saveArtworkSource(a.id,{platform:"pixiv",workId:"123",pageIndex:0,authorId:"456",authorName:"画师",title:"内部图片"});
    const result=await gallerySettled(f,f.service.searchGallery(1,"不存在于名称里的中文画面",{search:"无匹配标题",favorite:true,ownership:"external",collectionId:album.id}).progress.id);
    expect(result.progress.total).toBe(1);expect(result.result.items.map(work=>work.id)).toEqual([`local:${b.id}`]);
    expect(result.progress.galleryQuery).toEqual({favorite:true,ownership:"external",collectionId:album.id});
    f.database.updateWorkFavorite([`local:${b.id}`],false);
    expect(f.service.galleryResults(1,result.progress.id).result).toMatchObject({items:[],total:0,totalPages:0});
    const empty=await gallerySettled(f,f.service.searchGallery(1,"中文",{favorite:true,ownership:"managed"}).progress.id);
    expect(empty.progress).toMatchObject({phase:"completed",total:0});expect(empty.result.items).toEqual([]);
  });
  it("isolates missing originals, preserves completed indexes on cancellation and reports unavailable models before scanning",async()=>{
    const f=fixture();f.database.importArtwork(f.image("broken.png",f.folder,"broken"));
    const bad=await gallerySettled(f,f.service.searchGallery(1,"画面",{}).progress.id);
    expect(bad.progress).toMatchObject({failed:1,processed:1});expect(bad.result.items).toEqual([]);
    f.database.importArtwork(f.image("night.png"));let release!:(v:number[])=>void;
    f.encode.mockImplementationOnce(()=>new Promise(done=>{release=done;}));
    const started=f.service.searchGallery(1,"慢查询",{});expect(()=>f.service.searchGallery(1,"不能并行",{})).toThrow("停止");
    f.service.cancel(1,started.progress.id);release(vector(1));const cancelled=await gallerySettled(f,started.progress.id);
    expect(cancelled.progress.phase).toBe("cancelled");expect(cancelled.progress.processed).toBe(0);
    vi.spyOn(f.semantic,"availability").mockReturnValue({available:false,model:"test",device:"cpu",message:"模型未准备"});
    expect(()=>f.service.searchGallery(1,"中文",{})).toThrow("未准备");
  });
  it("searches beyond the old 1000-page workbench batch and paginates bounded work cards",async()=>{
    const f=fixture();const path=f.image("night.png");
    for(let i=0;i<1001;i++){const itemPath=path+`-${i}.png`;writeFileSync(itemPath,PNG);f.database.importArtwork(itemPath);}
    const result=await gallerySettled(f,f.service.searchGallery(1,"中文",{}).progress.id);
    expect(result.progress).toMatchObject({total:1001,processed:1001,limitReached:false});expect(result.result.items).toHaveLength(60);expect(result.result.hasMore).toBe(true);
    const last=f.service.galleryResults(1,result.progress.id,960);expect(last.result.items).toHaveLength(41);expect(last.result.hasMore).toBe(false);
    expect(f.encode).toHaveBeenCalledTimes(2);expect(()=>f.service.galleryResults(1,result.progress.id,-1)).toThrow("分页");
  },40000);
  it("hides scores below the inclusive model threshold before grouping and paging, without discarding the index",async()=>{
    const f=fixture();
    f.encode.mockImplementation(async(kind,value)=>{
      if(kind==="query")return vector(1);
      const score=value.includes("weak")?GALLERY_SEARCH_MIN_SIMILARITY-.001:GALLERY_SEARCH_MIN_SIMILARITY;
      const v=vector(0);v[0]=Math.sqrt(1-score*score);v[1]=score;return v;
    });
    for(let i=0;i<62;i++)f.database.importArtwork(f.image(`boundary-${i}.png`));
    const weak=f.database.importArtwork(f.image("weak.png"));
    const result=await gallerySettled(f,f.service.searchGallery(1,"画面",{}).progress.id),calls=f.encode.mock.calls.length;
    expect(result.result).toMatchObject({total:62,totalPages:62,hasMore:true});expect(result.result.items).toHaveLength(60);
    expect(result.relevance).toEqual({mode:"relevant",minimumScore:GALLERY_SEARCH_MIN_SIMILARITY,hiddenWorks:1,hiddenPages:1});
    const last=f.service.galleryResults(1,result.progress.id,60);expect(last.result.items).toHaveLength(2);expect(last.result.hasMore).toBe(false);
    const all=f.service.galleryResults(1,result.progress.id,60,"all");expect(all.result).toMatchObject({total:63,totalPages:63,hasMore:false});
    expect(all.result.items.at(-1)?.id).toBe(`local:${weak.id}`);expect(all.relevance.hiddenWorks).toBe(0);expect(f.encode).toHaveBeenCalledTimes(calls);
    expect(()=>f.service.galleryResults(1,result.progress.id,0,.5)).toThrow("范围");expect(()=>f.service.galleryResults(2,result.progress.id,0,"all")).toThrow("过期");
    f.database.updateWorkFavorite([`local:${weak.id}`],true);
    // Counts still follow the live database filters, rather than counting removed/filtered works.
    const filtered=await gallerySettled(f,f.service.searchGallery(1,"画面",{favorite:true}).progress.id);
    expect(filtered.result).toMatchObject({items:[],total:0,totalPages:0,hasMore:false});expect(filtered.relevance.hiddenWorks).toBe(1);
    const expanded=f.service.galleryResults(1,filtered.progress.id,0,"all");expect(expanded.result.items[0]?.id).toBe(`local:${weak.id}`);
    f.database.updateWorkFavorite([`local:${weak.id}`],false);
    expect(f.service.galleryResults(1,filtered.progress.id).relevance.hiddenWorks).toBe(0);
  });
  it("runs a library request directly, scans exact pages and reports empty ranges or model failures",async()=>{
    const f=fixture(),a=f.database.importArtwork(f.image("day.png")),b=f.database.importArtwork(f.image("night.png"));
    const result=await settled(f.service,f.service.runLibrary(1,{type:"selected",workIds:[`local:${b.id}`]},description));
    expect(result).toMatchObject({phase:"completed",total:1,processed:1,matched:1});expect(result.items[0]?.fileName).toBe("night.png");
    expect(f.classify).not.toHaveBeenCalled();expect(()=>f.service.runLibrary(1,{type:"anything"},description)).toThrow("范围");
    expect(()=>f.service.get(2,result.id)).toThrow("过期");
    f.database.removeWorkFromIndex(`local:${b.id}`);
    expect(f.service.get(1,result.id)).toMatchObject({total:0,processed:0,matched:0,items:[]});
    const empty=await settled(f.service,f.service.runLibrary(1,{type:"selected",workIds:[]},rules));expect(empty).toMatchObject({phase:"completed",total:0});
    f.ready.mockReturnValue(false);
    const unavailable=await settled(f.service,f.service.runLibrary(1,{type:"selected",workIds:[`local:${a.id}`]},rules));
    expect(unavailable.phase).toBe("failed");expect(unavailable.error).toContain("尚未就绪");
  });
});
