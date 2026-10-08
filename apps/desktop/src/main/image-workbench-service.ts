import { randomUUID } from "node:crypto";
import { lstat, opendir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { LibraryDatabase } from "@sanctuary/database";
import { isAnalysisScope, type AnalysisScope, type FilterRule, type ImageTarget, type VisionAssessment,
  type WorkbenchItem, type WorkbenchQuery, type WorkbenchSnapshot, type WorkbenchSource, type ImageTaskSummary, type WorkAssetRecord, type WorkQuery, type GallerySearchSnapshot } from "@sanctuary/domain";
import { fingerprintImage, LocalImportService } from "./local-import-service.js";
import { parseImageTargets, type ResolvedImage } from "./image-output-service.js";
import type { SemanticClient, SemanticVectorStore } from "./semantic-client.js";

const MAX_IMAGES=1000, MAX_GALLERY_IMAGES=10000, MAX_ENTRIES=20000;
// EmbeddingGemma 2 cosine scores, not calibrated probabilities. Keep this model-specific
// display heuristic reversible without encoding the images again.
export const GALLERY_SEARCH_MIN_SIMILARITY=0.65;
interface Entry { asset?: WorkAssetRecord; item: WorkbenchItem; path: string; hash?: string; assessment?: VisionAssessment; assessmentHash?: string; assessmentModel?: string }
interface Session { owner: number; state: WorkbenchSnapshot; root?: string; entries: Entry[]; cancelled: boolean; touched: number }
export interface WorkbenchVision {
  ready(): boolean;
  identity(): string;
  classify(path: string): Promise<VisionAssessment>;
  rules(): FilterRule[];
}
export function parseWorkbenchQuery(value: unknown): WorkbenchQuery {
  if(!value || typeof value!=="object")throw new Error("查找条件无效");
  const v=value as Record<string,unknown>;
  if(!["rules","elements","description"].includes(String(v.mode)) || typeof v.text!=="string" || v.text.length>500)throw new Error("请填写 500 字以内的画面描述");
  const tags=(input: unknown)=>{
    if(!Array.isArray(input)||input.length>20||!input.every(t=>typeof t==="string"&&/^[a-z0-9_():.-]{1,100}$/i.test(t)))throw new Error("元素条件无效，请使用识别标签");
    return [...new Set(input as string[])];
  };
  const query={mode:v.mode as WorkbenchQuery["mode"],text:v.text.trim(),include:tags(v.include),exclude:tags(v.exclude)};
  if(query.mode==="description"&&!query.text)throw new Error("先描述你想找的画面");
  if(query.mode==="elements"&&!query.include.length&&!query.exclude.length)throw new Error("请选择至少一个需要或排除的元素");
  if(query.include.some(t=>query.exclude.includes(t)))throw new Error("同一个元素不能同时需要和排除");
  return query;
}

/** Session-only folder manifests. Paths never enter renderer commands or an unrestricted protocol. */
export class ImageWorkbenchService {
  #sessions=new Map<string,Session>();
  constructor(private database: Pick<LibraryDatabase,"getWork"|"listWorkbenchAssets"|"listGallerySearchAssets"|"gallerySearchAsset"|"matchingWorkIds"|"queryWorkIds"|"addArtworksToCollection">, private vision: WorkbenchVision,
    private semantic: Pick<SemanticClient,"availability"|"encode"|"close">, private vectors: Pick<SemanticVectorStore,"get"|"put">,
    private importer: LocalImportService) {}

  chooseFolder(owner: number, path: string, recursive: boolean): WorkbenchSnapshot {
    this.#assertIdle(); const s=this.#create(owner,"folder",basename(path),recursive);s.root=resolve(path);void this.#scanFolder(s);return this.#snapshot(s,0,"all");
  }
  chooseLibrary(owner: number, value: unknown): WorkbenchSnapshot {
    if(!isAnalysisScope(value))throw new Error("整理范围无效");
    this.#assertIdle();const s=this.#create(owner,"library","当前图库范围",false);s.state.scope=value;void this.#scanLibrary(s,value);return this.#snapshot(s,0,"all");
  }
  current(owner: number, source: unknown): WorkbenchSnapshot | null {
    this.#prune();if(source!=="folder"&&source!=="library")throw new Error("图片来源无效");
    const s=[...this.#sessions.values()].reverse().find(s=>s.owner===owner&&s.state.source===source&&!s.state.galleryQuery);
    return s?this.#snapshot(s,0,"all"):null;
  }
  searchGallery(owner: number, value: unknown, query: WorkQuery): GallerySearchSnapshot {
    const description = parseWorkbenchQuery({mode:"description",text:value,include:[],exclude:[]});
    if(!this.semantic.availability().available)throw new Error(this.semantic.availability().message);
    this.#assertIdle();
    const {search:_search,sortBy:_sort,direction:_direction,offset:_offset,limit:_limit,...filters}=query;
    const s=this.#create(owner,"library",description.text,false,filters);
    s.state.query=description;
    void this.#scanGallery(s,filters,description);
    return this.galleryResults(owner,s.state.id,0);
  }
  galleryResults(owner: number, id: unknown, offset: unknown=0, relevance: unknown="relevant"): GallerySearchSnapshot {
    if(typeof offset!=="number"||!Number.isSafeInteger(offset)||offset<0||offset>MAX_GALLERY_IMAGES)throw new Error("分页请求无效");
    if(relevance!=="relevant"&&relevance!=="all")throw new Error("搜索结果范围无效");
    const s=this.#owned(owner,id);if(!s.state.galleryQuery)throw new Error("这不是图库画面搜索，请重新找图");
    const ready=s.entries.filter(e=>e.item.status==="ready"&&Number.isFinite(e.item.score)&&e.asset);
    ready.sort((a,b)=>b.item.score!-a.item.score!||a.item.id.localeCompare(b.item.id));
    const best=new Map<string,Entry>();
    for(const entry of ready)if(!best.has(entry.asset!.workId))best.set(entry.asset!.workId,entry);
    const eligible=this.database.matchingWorkIds([...best.keys()],s.state.galleryQuery);
    const available=[...best.values()].filter(entry=>eligible.has(entry.asset!.workId));
    const accepts=(entry:Entry)=>relevance==="all"||entry.item.score!>=GALLERY_SEARCH_MIN_SIMILARITY;
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
      relevance:{mode:relevance,minimumScore:GALLERY_SEARCH_MIN_SIMILARITY,hiddenWorks:available.length-entries.length,hiddenPages:eligiblePages.length-matchingPages}};
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
          this.#entry(s,asset.path,title,{workId:asset.workId,assetId:asset.id},asset.thumbnailPath??asset.path,asset);
        }
        if(s.state.limitReached||rows.length<100)break;
        await new Promise<void>(done=>setImmediate(done));
      }
      if(s.state.limitReached)s.state.warnings.push("本次已达到 10,000 张图片的上限，其余图片尚未搜索。请按相册、画师或保存方式缩小范围。");
      s.state.phase=s.cancelled?"cancelled":"ready";
      if(s.cancelled||!s.entries.length){if(!s.cancelled)s.state.phase="completed";return;}
      this.start(s.owner,s.state.id,description);
    }catch(error){s.state.phase=s.cancelled?"cancelled":"failed";if(!s.cancelled)s.state.error=this.#message(error);}
  }
  tasks(owner: number): ImageTaskSummary[] {
    this.#prune();return [...this.#sessions.values()].filter(s=>s.owner===owner).map(s=>({id:s.state.id,kind:"workbench",source:s.state.source,name:s.state.name,
      phase:s.state.phase,total:s.entries.length,processed:s.state.processed,failed:s.state.failed,cancelRequested:s.cancelled,...(s.state.galleryQuery?{gallerySearch:true}:{})}));
  }
  get(owner: number,id: unknown,offset: unknown=0,filter: unknown="matches"): WorkbenchSnapshot {
    if(typeof offset!=="number"||!Number.isSafeInteger(offset)||offset<0||offset>MAX_IMAGES||!["matches","all","failed"].includes(String(filter)))throw new Error("分页请求无效");
    return this.#snapshot(this.#owned(owner,id),offset,filter as string);
  }
  start(owner: number,id: unknown,value: unknown): WorkbenchSnapshot {
    const s=this.#owned(owner,id);this.#assertIdle();
    if(s.state.phase==="scanning"||!s.entries.length)throw new Error("请先等待图片扫描完成");
    const query=parseWorkbenchQuery(value);
    if((query.mode!=="description"||query.include.length||query.exclude.length)&&!this.vision.ready())throw new Error("元素识别模型尚未就绪，请在探索的浏览保护中检查模型后重试");
    if(query.mode==="description"&&!this.semantic.availability().available)throw new Error(this.semantic.availability().message);
    const rules=this.vision.rules().filter(r=>r.enabled);
    if(query.mode==="rules"&&!rules.length)throw new Error("探索没有启用元素规则，请先在探索调整规则");
    s.state.query=query;s.state.phase="analyzing";s.state.processed=0;s.state.failed=0;delete s.state.error;s.cancelled=false;s.state.cancelRequested=false;
    s.state.engine=query.mode==="description"?"EmbeddingGemma 2 · CPU" : this.vision.identity();
    for(const e of s.entries){e.item.status="pending";delete e.item.error;delete e.item.score;delete e.item.matched;delete e.item.matchedTags;}
    void this.#analyze(s,query,rules);return this.#snapshot(s,0,"all");
  }
  cancel(owner: number,id: unknown): WorkbenchSnapshot {
    const s=this.#owned(owner,id);s.cancelled=true;s.state.cancelRequested=true;
    if(s.state.phase==="analyzing"&&s.state.query?.mode==="description")this.semantic.close();
    return this.#snapshot(s,0,"all");
  }
  async prepareImport(owner: number,id: unknown,ids: unknown) {
    const s=this.#owned(owner,id);if(s.state.source!=="folder")throw new Error("图库图片无需再次导入");
    const targets=this.#selectedIds(ids).map(itemId=>({sessionId:s.state.id,itemId}));
    const files=await this.resolveImages(owner,targets);return this.importer.choose(owner,files.map(f=>f.path));
  }
  assign(owner: number,id: unknown,ids: unknown,collectionId: unknown): number {
    const s=this.#owned(owner,id);
    if(s.state.source!=="library"||typeof collectionId!=="string"||collectionId.length>300)throw new Error("入册请求无效");
    const legacy=this.#selectedIds(ids).map(itemId=>{
      const target=s.entries.find(e=>e.item.id===itemId)?.item.target;
      if(!target||!("workId" in target))throw new Error("所选图片已失效");
      const asset=this.database.getWork(target.workId)?.assets.find(a=>a.id===target.assetId);
      if(!asset?.legacyArtworkId)throw new Error("所选图片无法按页入册，请在图库归档整件作品");
      return asset.legacyArtworkId;
    });
    return this.database.addArtworksToCollection(legacy,collectionId);
  }
  async resolveImages(owner: number,targets: ImageTarget[]): Promise<ResolvedImage[]> {
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
      }else{
        const s=this.#owned(owner,target.sessionId),e=s.entries.find(e=>e.item.id===target.itemId);
        if(!e)throw new Error("所选图片已失效，请重新选择文件夹");
        await this.#authorize(s,e.path);
        if(!seen.has(e.path)){seen.add(e.path);files.push({target,path:e.path,fileName:basename(e.path)});}
      }
      if(files.length>1000)throw new Error("一次最多处理 1,000 张原图，请缩小选择范围");
    }
    return files;
  }
  async preview(url: string): Promise<string | null> {
    try {
      const u=new URL(url);if(u.hostname!=="workbench")return null;
      const [id,itemId,...extra]=u.pathname.slice(1).split("/");if(extra.length||!id||!itemId)return null;
      this.#prune();const s=this.#sessions.get(id),e=s?.entries.find(e=>e.item.id===itemId);if(!s||!e)return null;
      await this.#authorize(s,e.path);return e.path;
    }catch{return null;}
  }
  close(){for(const s of this.#sessions.values())s.cancelled=true;this.semantic.close();}
  #create(owner: number,source: WorkbenchSource,name: string,recursive: boolean,galleryQuery?: WorkQuery): Session {
    this.#prune();for(const [id,s] of this.#sessions)if(s.owner===owner&&s.state.source===source&&Boolean(s.state.galleryQuery)===Boolean(galleryQuery))this.#sessions.delete(id);
    const s: Session={owner,entries:[],cancelled:false,touched:Date.now(),state:{...(galleryQuery?{galleryQuery}:{}),id:randomUUID(),source,name,recursive,phase:"scanning",cancelRequested:false,total:0,processed:0,failed:0,matched:0,unanalysed:0,visited:0,limitReached:false,warnings:[],items:[],hasMore:false}};
    this.#sessions.set(s.state.id,s);return s;
  }
  #entry(s: Session,path: string,title: string,target?: ImageTarget,previewPath?: string,asset?: WorkAssetRecord) {
    const id=randomUUID();s.entries.push({path,...(asset?{asset}:{}),item:{id,fileName:basename(path),title,
      previewUrl:target?`sanctuary-image://local/${encodeURIComponent(previewPath??path)}`:`sanctuary-image://workbench/${s.state.id}/${id}`,
      target:target??{sessionId:s.state.id,itemId:id},status:"pending"}});s.state.total=s.entries.length;
  }
  async #scanFolder(s: Session) {
    try {
      const root=await lstat(s.root!);if(!root.isDirectory()||root.isSymbolicLink())throw new Error("请选择普通图片文件夹，不能使用目录链接");
      s.root=await realpath(s.root!);const queue=[s.root];
      while(queue.length&&!s.cancelled&&!s.state.limitReached){
        const directory=queue.shift()!;
        // Directory links created after the picker/scan are rejected too.
        if(directory!==s.root)await this.#authorize(s,join(directory,".scan-marker"),true);
        try {
          for await(const entry of await opendir(directory)){
            if(s.cancelled)break;
            if(++s.state.visited>MAX_ENTRIES){s.state.limitReached=true;break;}
            if(entry.isSymbolicLink())continue;
            const path=join(directory,entry.name);
            if(entry.isDirectory()&&s.state.recursive)queue.push(path);
            if(entry.isFile()&&/\.(jpe?g|png|webp|gif|avif)$/i.test(entry.name)){
              if(s.entries.length>=MAX_IMAGES){s.state.limitReached=true;break;}
              this.#entry(s,path,relative(s.root,path));
            }
          }
        }catch{if(directory===s.root)throw new Error("无法读取所选文件夹，请检查访问权限");if(s.state.warnings.length<5)s.state.warnings.push(`无法读取子文件夹：${basename(directory)}`);}
      }
      s.state.phase=s.cancelled?"cancelled":"ready";
      if(s.state.limitReached)s.state.warnings.push("已达到本批上限（1,000 张图片或 20,000 个目录项），范围未扫描完。请改选更小的文件夹。");
    }catch(error){s.state.phase="failed";s.state.error=this.#message(error);}
  }
  async #scanLibrary(s: Session,scope: AnalysisScope) {
    try {
      for(let offset=0;!s.cancelled;offset+=100){
        const rows=this.database.listWorkbenchAssets(scope,offset,100);
        for(const {asset,title} of rows){if(s.entries.length>=MAX_IMAGES){s.state.limitReached=true;break;}
          this.#entry(s,asset.path,`${title} · 第 ${asset.pageIndex+1} 页`,{workId:asset.workId,assetId:asset.id},asset.thumbnailPath??asset.path);}
        if(s.state.limitReached||rows.length<100)break;
        await new Promise<void>(done=>setImmediate(done));
      }
      if(s.state.limitReached)s.state.warnings.push("当前范围超过 1,000 张图片，请通过相册、画师或图库已选缩小范围后重建。");
      s.state.phase=s.cancelled?"cancelled":"ready";
    }catch(error){s.state.phase="failed";s.state.error=this.#message(error);}
  }
  async #analyze(s: Session,q: WorkbenchQuery,rules: FilterRule[]) {
    const model=this.vision.identity();
    try {
      const queryVector=q.mode==="description"?await this.semantic.encode("query",q.text):null;
      for(const e of s.entries){
        if(s.cancelled)break;
        try {
          if(s.state.galleryQuery&&e.asset){
            const current=this.database.gallerySearchAsset(e.asset.workId,e.asset.id);
            if(!current||current.path!==e.path)throw new Error("图片记录或原位置已变化，请重新找图");
            e.asset=current;
          }else await this.resolveImages(s.owner,[e.item.target]);
          const hash=await fingerprintImage(e.path);e.hash=hash;
          let labels: Record<string,number>={};
          if(q.mode!=="description"||q.include.length||q.exclude.length){
            if(this.vision.identity()!==model)throw new Error("识别模型已改变，请重新开始本批分析");
            if(e.assessmentHash!==hash||e.assessmentModel!==model||!e.assessment){
              const assessment=await this.vision.classify(e.path);
              if(assessment.status!=="complete"||assessment.engine==="filename-probe"||this.vision.identity()!==model)throw new Error("元素识别失败或模型已改变，请重试");
              e.assessment=assessment;e.assessmentHash=hash;e.assessmentModel=model;
            }
            labels=e.assessment.labels;
          }
          if(s.cancelled)break;
          let vector:number[]|null=null,needsCache=false;
          if(queryVector){
            vector=this.vectors.get(hash);
            if(!vector){vector=await this.semantic.encode("image",e.path);needsCache=true;}
          }
          if(await fingerprintImage(e.path)!==hash)throw new Error("图片在分析中发生变化，请重试");
          if(vector&&needsCache)this.vectors.put(hash,vector);
          const tags=q.mode==="rules"?rules.filter(r=>(labels[r.label]??0)>=r.minimumConfidence).map(r=>r.label):q.include.filter(t=>(labels[t]??0)>=0.4);
          const allowed=q.include.every(t=>(labels[t]??0)>=0.4)&&q.exclude.every(t=>(labels[t]??0)<0.4);
          e.item.matched=allowed&&(q.mode!=="rules"||tags.length>0);e.item.matchedTags=[...new Set(tags)];
          if(vector&&queryVector)e.item.score=vector.reduce((sum,n,i)=>sum+n*queryVector[i]!,0);
          e.item.status="ready";
        }catch(error){delete e.assessment;delete e.assessmentHash;delete e.assessmentModel;if(s.cancelled)break;e.item.status="failed";e.item.error=this.#message(error);s.state.failed++;}
        s.state.processed++;s.touched=Date.now();
      }
      s.state.phase=s.cancelled?"cancelled":"completed";
    }catch(error){s.state.phase=s.cancelled?"cancelled":"failed";if(!s.cancelled)s.state.error=this.#message(error);}
  }
  async #authorize(s: Session,path: string,missingLeaf=false) {
    if(!s.root)throw new Error("图片来源无效");
    const rel=relative(s.root,path);if(!rel||rel.startsWith(".."+sep)||rel===".."||isAbsolute(rel))throw new Error("图片不在授权文件夹中");
    if(await realpath(s.root)!==s.root)throw new Error("授权文件夹已变化，请重新选择");
    let cursor=s.root;const parts=rel.split(sep);if(missingLeaf)parts.pop();
    for(const part of parts){cursor=join(cursor,part);const info=await lstat(cursor);if(info.isSymbolicLink())throw new Error("不能读取文件夹中的链接");}
    if(!missingLeaf){const info=await lstat(path);if(!info.isFile()||info.size>512*1024*1024)throw new Error("图片不可读取或超过 512 MB");}
  }
  #snapshot(s: Session,offset: number,filter: string): WorkbenchSnapshot {
    s.touched=Date.now();const entries=s.entries.filter(e=>filter==="failed"?e.item.status==="failed":filter==="matches"&&s.state.query?e.item.matched===true:true);
    if(s.state.query?.mode==="description")entries.sort((a,b)=>(b.item.score??-2)-(a.item.score??-2)||a.item.id.localeCompare(b.item.id));
    return structuredClone({...s.state,matched:s.entries.filter(e=>e.item.matched).length,unanalysed:s.entries.filter(e=>e.item.status==="pending").length,
      items:entries.slice(offset,offset+60).map(e=>e.item),hasMore:entries.length>offset+60});
  }
  #owned(owner: number,id: unknown): Session {
    this.#prune();const s=typeof id==="string"?this.#sessions.get(id):undefined;
    if(!s||s.owner!==owner)throw new Error("这次找图记录已过期，请重新找图或选择文件夹");s.touched=Date.now();return s;
  }
  #selectedIds(value: unknown): string[] {
    if(!Array.isArray(value)||!value.length||value.length>500||!value.every(id=>typeof id==="string"&&id.length<=100))throw new Error("请一次选择 1–500 张图片");return [...new Set(value as string[])];
  }
  #assertIdle(){if([...this.#sessions.values()].some(s=>s.state.phase==="scanning"||s.state.phase==="analyzing"))throw new Error("请先停止当前扫描或分析任务");}
  #prune(){const done=[...this.#sessions.values()].filter(s=>!["scanning","analyzing"].includes(s.state.phase)).sort((a,b)=>b.touched-a.touched);for(const s of done)if(Date.now()-s.touched>30*60_000||done.indexOf(s)>=8)this.#sessions.delete(s.state.id);}
  #message(error: unknown){const text=error instanceof Error?error.message:"分析失败，请重试";return /[\u4e00-\u9fff]/.test(text)?text:"文件无法读取，请检查文件或访问权限后重试";}
}
