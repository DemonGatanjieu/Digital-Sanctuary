import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryDatabase } from "@sanctuary/database";
import { GALLERY_SEARCH_MIN_SIMILARITY, ImageWorkbenchService, parseDescription } from "./image-workbench-service";
import { SemanticVectorStore } from "./semantic-client";
import { ImageOutputService } from "./image-output-service";
const PNG=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
const cleanups:(()=>void)[]=[];
afterEach(()=>{cleanups.splice(0).forEach(f=>f());vi.restoreAllMocks();});
function vector(index:number){const v=Array<number>(768).fill(0);v[index]=1;return v;}
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"sanctuary-workbench-test-")),folder=join(root,"images");mkdirSync(folder);
  const database=new LibraryDatabase(":memory:"),vectors=new SemanticVectorStore(join(root,"vectors.db"));
  const encode=vi.fn(async(kind:"image"|"query",value:string)=>vector(kind==="query"||value.includes("night")?1:0));
  const semantic={availability:()=>({available:true,model:"test",device:"cpu" as const,message:"test"}),encode,close:vi.fn()};
  const service=new ImageWorkbenchService(database,semantic,vectors);
  cleanups.push(()=>{service.close();vectors.close();database.close();rmSync(root,{recursive:true,force:true});});
  const image=(name:string,dir=folder,content:Buffer|string=Buffer.concat([PNG,Buffer.from(name)]))=>{const path=join(dir,name);writeFileSync(path,content);return path;};
  return {root,folder,database,vectors,service,image,encode,semantic};
}

describe("library image export targets",()=>{
  it("reports missing indexed pages as export failures instead of silently dropping them",async()=>{
    const f=fixture(),path=f.image("missing.png"),art=f.database.importArtwork(path),destination=join(f.root,"export");mkdirSync(destination);rmSync(path);
    const service=new ImageOutputService((owner,targets)=>f.service.resolveImages(owner,targets),{chooseDirectory:async()=>destination,copyImage:async()=>{},reveal:()=>{}});
    const batch=(await service.start(1,[{workId:`local:${art.id}`}]))!;
    for(let i=0;i<100&&service.get(1,batch.id).phase==="running";i++)await new Promise(done=>setTimeout(done,5));
    expect(service.get(1,batch.id).items).toEqual([expect.objectContaining({fileName:"missing.png",status:"failed"})]);
  });
  it("only accepts library pages and validates descriptions",async()=>{
    const f=fixture();
    await expect(f.service.resolveImages(1,[{sessionId:"gone",itemId:"x"}])).rejects.toThrow("图库");
    expect(()=>parseDescription("  ")).toThrow("描述");expect(()=>parseDescription("x".repeat(501))).toThrow("500");
    expect(parseDescription(" 海边 ")).toEqual({mode:"description",text:"海边",include:[],exclude:[]});
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
    const started=f.service.searchGallery(1,"夜晚的月亮",{}),result=await gallerySettled(f,started.progress.id);
    expect(result.progress).toMatchObject({phase:"completed",processed:2,total:2});
    expect(result.result).toMatchObject({total:1,totalPages:1});
    expect(result.relevance).toMatchObject({mode:"relevant",hiddenWorks:0,hiddenPages:1});
    expect(f.service.galleryResults(1,started.progress.id,0,"all").result.totalPages).toBe(2);
    expect(result.result.items[0]).toMatchObject({id:"pixiv:123",matchedPage:1,coverAsset:{pageIndex:1,path:pages[1]!.path}});
    expect(f.encode).toHaveBeenCalledTimes(3);
    expect(f.service.tasks(1)[0]).toMatchObject({gallerySearch:true});
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
});
