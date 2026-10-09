import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { LibraryDatabase } from "@sanctuary/database";
import type { ImageTarget, WorkbenchItem, WorkbenchQuery, WorkbenchSnapshot, ImageTaskSummary, WorkAssetRecord, WorkQuery, GallerySearchSnapshot } from "@sanctuary/domain";
import { fingerprintImage } from "./local-import-service.js";
import { parseImageTargets, type ResolvedImage } from "./image-output-service.js";
import type { SemanticClient, SemanticVectorStore } from "./semantic-client.js";

const MAX_GALLERY_IMAGES=10000;
// EmbeddingGemma 2 cosine scores, not calibrated probabilities. Keep this model-specific
// display heuristic reversible without encoding the images again.
export const GALLERY_SEARCH_MIN_SIMILARITY=0.65;
// Picture-to-picture cosine runs much higher than text-to-picture, so "similar" keeps its own default cut-off.
export const SIMILAR_PICTURE_MIN_SIMILARITY=0.8;
interface Entry { asset: WorkAssetRecord; item: WorkbenchItem; path: string }
interface Session { owner: number; state: WorkbenchSnapshot; entries: Entry[]; cancelled: boolean; touched: number;
  /** "Find similar": the page whose picture is the query, and its work, which is left out of the results. */
  source?: WorkAssetRecord; minimumScore: number }
export function parseDescription(value: unknown): WorkbenchQuery {
  if(typeof value!=="string"||value.length>500)throw new Error("请填写 500 字以内的画面描述");
  const text=value.trim();if(!text)throw new Error("先描述你想找的画面");
  return {mode:"description",text,include:[],exclude:[]};
}

/**
 * Gallery picture search: one session per window scans the filtered library, encodes each page once
 * (content-hash cache) and ranks works by their best page. Also resolves library pages for image export.
 */
export class ImageWorkbenchService {
  #sessions=new Map<string,Session>();
  constructor(private database: Pick<LibraryDatabase,"getWork"|"listGallerySearchAssets"|"gallerySearchAsset"|"matchingWorkIds"|"queryWorkIds">,
    private semantic: Pick<SemanticClient,"availability"|"encode"|"close">, private vectors: Pick<SemanticVectorStore,"get"|"put">) {}

  searchGallery(owner: number, value: unknown, query: WorkQuery): GallerySearchSnapshot {
    const description = parseDescription(value);
    if(!this.semantic.availability().available)throw new Error(this.semantic.availability().message);
    this.#assertIdle();
    const {search:_search,sortBy:_sort,direction:_direction,offset:_offset,limit:_limit,...filters}=query;
    const s=this.#create(owner,description.text,filters);
    s.state.query=description;
    void this.#scanGallery(s,filters,description);
    return this.galleryResults(owner,s.state.id,0);
  }
  /** Ranks the filtered library by how much each page looks like one library page. */
  searchSimilar(owner: number, workId: unknown, assetId: unknown, query: WorkQuery): GallerySearchSnapshot {
    if(typeof workId!=="string"||typeof assetId!=="string"||workId.length>300||assetId.length>300)throw new Error("请选择一张图库里的图片");
    const source=this.database.gallerySearchAsset(workId,assetId);if(!source)throw new Error("这张图片已不在图库里，请刷新后重试");
    if(!this.semantic.availability().available)throw new Error(this.semantic.availability().message);
    this.#assertIdle();
    const {search:_search,sortBy:_sort,direction:_direction,offset:_offset,limit:_limit,...filters}=query;
    const title=this.database.queryWorkIds([workId])[0]?.title??basename(source.path);
    const description:WorkbenchQuery={mode:"description",text:`相似：${title}`,include:[],exclude:[]};
    const s=this.#create(owner,description.text,filters);
    s.source=source;s.minimumScore=SIMILAR_PICTURE_MIN_SIMILARITY;s.state.query=description;
    void this.#scanGallery(s,filters,description);
    return this.galleryResults(owner,s.state.id,0);
  }
  galleryResults(owner: number, id: unknown, offset: unknown=0, relevance: unknown="relevant"): GallerySearchSnapshot {
    if(typeof offset!=="number"||!Number.isSafeInteger(offset)||offset<0||offset>MAX_GALLERY_IMAGES)throw new Error("分页请求无效");
    if(relevance!=="relevant"&&relevance!=="all")throw new Error("搜索结果范围无效");
    const s=this.#owned(owner,id);if(!s.state.galleryQuery)throw new Error("这不是图库画面搜索，请重新找图");
    const ready=s.entries.filter(e=>e.item.status==="ready"&&Number.isFinite(e.item.score)&&e.asset&&e.asset.workId!==s.source?.workId);
    ready.sort((a,b)=>b.item.score!-a.item.score!||a.item.id.localeCompare(b.item.id));
    const best=new Map<string,Entry>();
    for(const entry of ready)if(!best.has(entry.asset!.workId))best.set(entry.asset!.workId,entry);
    const eligible=this.database.matchingWorkIds([...best.keys()],s.state.galleryQuery);
    const available=[...best.values()].filter(entry=>eligible.has(entry.asset!.workId));
    const accepts=(entry:Entry)=>relevance==="all"||entry.item.score!>=s.minimumScore;
    const entries=available.filter(accepts),page=entries.slice(offset,offset+60);
    const eligiblePages=ready.filter(entry=>eligible.has(entry.asset!.workId));
    const matchingPages=eligiblePages.filter(accepts).length;
    const records=new Map(this.database.queryWorkIds(page.map(e=>e.asset!.workId)).map(work=>[work.id,work]));
    const items=page.flatMap(entry=>{
      const work=records.get(entry.asset!.workId);if(!work)return [];
      const asset=work.coverAsset?.id===entry.asset!.id?work.coverAsset:this.database.gallerySearchAsset(work.id,entry.asset!.id);
      return asset?[{...work,coverAsset:asset,matchedPage:asset.pageIndex}]:[];
    });
    return {progress:structuredClone({...s.state,items:[],hasMore:false,matched:matchingPages,unanalysed:s.entries.filter(e=>e.item.status==="pending").length}),
      result:{items,total:entries.length,totalPages:matchingPages,offset,limit:60,hasMore:offset+60<entries.length},
      relevance:{mode:relevance,minimumScore:s.minimumScore,hiddenWorks:available.length-entries.length,hiddenPages:eligiblePages.length-matchingPages}};
  }
  currentGallery(owner: number): GallerySearchSnapshot | null {
    this.#prune();const s=[...this.#sessions.values()].reverse().find(s=>s.owner===owner&&s.state.galleryQuery);
    return s?this.galleryResults(owner,s.state.id):null;
  }
  async #scanGallery(s: Session,query: WorkQuery,description: WorkbenchQuery) {
    try {
      for(let offset=0;!s.cancelled;offset+=100){
        const rows=this.database.listGallerySearchAssets(query,offset,100);
        for(const {asset,title} of rows){
          if(s.entries.length>=MAX_GALLERY_IMAGES){s.state.limitReached=true;break;}
          this.#entry(s,asset,title);
        }
        if(s.state.limitReached||rows.length<100)break;
        await new Promise<void>(done=>setImmediate(done));
      }
      if(s.state.limitReached)s.state.warnings.push("本次已达到 10,000 张图片的上限，其余图片尚未搜索。请按相册、画师或保存方式缩小范围。");
      s.state.phase=s.cancelled?"cancelled":"ready";
      if(s.cancelled||!s.entries.length){if(!s.cancelled)s.state.phase="completed";return;}
      s.state.phase="analyzing";s.state.engine="EmbeddingGemma 2 · CPU";
      await this.#analyze(s,description);
    }catch(error){s.state.phase=s.cancelled?"cancelled":"failed";if(!s.cancelled)s.state.error=this.#message(error);}
  }
  tasks(owner: number): ImageTaskSummary[] {
    this.#prune();return [...this.#sessions.values()].filter(s=>s.owner===owner).map(s=>({id:s.state.id,kind:"workbench",source:s.state.source,name:s.state.name,
      phase:s.state.phase,total:s.entries.length,processed:s.state.processed,failed:s.state.failed,cancelRequested:s.cancelled,...(s.state.galleryQuery?{gallerySearch:true}:{})}));
  }
  cancel(owner: number,id: unknown): WorkbenchSnapshot {
    const s=this.#owned(owner,id);s.cancelled=true;s.state.cancelRequested=true;
    if(s.state.phase==="analyzing")this.semantic.close();
    return structuredClone({...s.state,items:[],hasMore:false});
  }
  async resolveImages(_owner: number,targets: ImageTarget[]): Promise<ResolvedImage[]> {
    const files: ResolvedImage[]=[],seen=new Set<string>();
    for(const target of parseImageTargets(targets)) {
      if("workId" in target){
        const work=this.database.getWork(target.workId);if(!work)throw new Error("作品已移出图库，请刷新后重试");
        const assets=target.assetId?work.assets.filter(a=>a.id===target.assetId):work.assets;
        if(!assets.length)throw new Error("找不到所选图片页");
        for(const a of assets){
          // Keep missing indexed originals in exports so each page gets an honest failure.
          if(a.mediaType!=="image") { if(target.assetId)throw new Error("所选页不是可复制的静态图片");continue; }
          if(!seen.has(a.path)){seen.add(a.path);files.push({target:{workId:work.id,assetId:a.id},path:a.path,fileName:basename(a.path)});}
        }
      }else throw new Error("所选图片已失效，请在图库中重新选择");
      if(files.length>1000)throw new Error("一次最多处理 1,000 张原图，请缩小选择范围");
    }
    return files;
  }
  close(){for(const s of this.#sessions.values())s.cancelled=true;this.semantic.close();}
  #create(owner: number,name: string,galleryQuery: WorkQuery): Session {
    this.#prune();for(const [id,s] of this.#sessions)if(s.owner===owner)this.#sessions.delete(id);
    const s: Session={owner,entries:[],cancelled:false,touched:Date.now(),minimumScore:GALLERY_SEARCH_MIN_SIMILARITY,state:{galleryQuery,id:randomUUID(),source:"library",name,recursive:false,phase:"scanning",cancelRequested:false,total:0,processed:0,failed:0,matched:0,unanalysed:0,visited:0,limitReached:false,warnings:[],items:[],hasMore:false}};
    this.#sessions.set(s.state.id,s);return s;
  }
  #entry(s: Session,asset: WorkAssetRecord,title: string) {
    const id=randomUUID();s.entries.push({path:asset.path,asset,item:{id,fileName:basename(asset.path),title,
      previewUrl:"sanctuary-image://local/"+encodeURIComponent(asset.thumbnailPath??asset.path),
      target:{workId:asset.workId,assetId:asset.id},status:"pending"}});s.state.total=s.entries.length;
  }
  async #analyze(s: Session,q: WorkbenchQuery) {
    try {
      const queryVector=s.source?await this.#pictureVector(s.source.path):await this.semantic.encode("query",q.text);
      for(const e of s.entries){
        if(s.cancelled)break;
        try {
          const current=this.database.gallerySearchAsset(e.asset.workId,e.asset.id);
          if(!current||current.path!==e.path)throw new Error("图片记录或原位置已变化，请重新找图");
          e.asset=current;
          const hash=await fingerprintImage(e.path);
          let vector=this.vectors.get(hash),needsCache=false;
          if(!vector){vector=await this.semantic.encode("image",e.path);needsCache=true;}
          if(s.cancelled)break;
          if(await fingerprintImage(e.path)!==hash)throw new Error("图片在分析中发生变化，请重试");
          if(needsCache)this.vectors.put(hash,vector);
          e.item.matched=true;e.item.score=vector.reduce((sum,n,i)=>sum+n*queryVector[i]!,0);
          e.item.status="ready";
        }catch(error){if(s.cancelled)break;e.item.status="failed";e.item.error=this.#message(error);s.state.failed++;}
        s.state.processed++;s.touched=Date.now();
      }
      s.state.phase=s.cancelled?"cancelled":"completed";
    }catch(error){s.state.phase=s.cancelled?"cancelled":"failed";if(!s.cancelled)s.state.error=this.#message(error);}
  }
  async #pictureVector(path: string): Promise<number[]> {
    const hash=await fingerprintImage(path);const cached=this.vectors.get(hash);if(cached)return cached;
    const vector=await this.semantic.encode("image",path);this.vectors.put(hash,vector);return vector;
  }
  #owned(owner: number,id: unknown): Session {
    this.#prune();const s=typeof id==="string"?this.#sessions.get(id):undefined;
    if(!s||s.owner!==owner)throw new Error("这次找图记录已过期，请重新找图");s.touched=Date.now();return s;
  }
  #assertIdle(){if([...this.#sessions.values()].some(s=>s.state.phase==="scanning"||s.state.phase==="analyzing"))throw new Error("请先停止当前扫描或分析任务");}
  #prune(){const done=[...this.#sessions.values()].filter(s=>!["scanning","analyzing"].includes(s.state.phase)).sort((a,b)=>b.touched-a.touched);for(const s of done)if(Date.now()-s.touched>30*60_000||done.indexOf(s)>=8)this.#sessions.delete(s.state.id);}
  #message(error: unknown){const text=error instanceof Error?error.message:"分析失败，请重试";return /[\u4e00-\u9fff]/.test(text)?text:"文件无法读取，请检查文件或访问权限后重试";}
}
