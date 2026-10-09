import type { GallerySearchRelevance, GallerySearchSnapshot, WorkQuery } from "@sanctuary/domain";

export function pictureSearchFilters(query: WorkQuery): WorkQuery {
  // elementMatch is the main process's resolution of `elements`, echoed back in progress snapshots.
  const {search:_search,sortBy:_sort,direction:_direction,offset:_offset,limit:_limit,elementMatch:_resolved,...filters}=query;
  return filters;
}
export function pictureSearchScopeKey(query: WorkQuery): string {
  return JSON.stringify(Object.entries(pictureSearchFilters(query)).filter(([,value])=>value!==undefined).sort(([a],[b])=>a.localeCompare(b)));
}
export function pictureSearchRunning(snapshot: GallerySearchSnapshot | null): boolean {
  return Boolean(snapshot && ["scanning","analyzing"].includes(snapshot.progress.phase));
}
export interface PictureSearchState {
  mode: "picture" | "name"; draft: string; snapshot: GallerySearchSnapshot | null; pending: boolean; error: string; relevance: GallerySearchRelevance;
}
export interface PictureSearchHost {
  start(text: string,query: WorkQuery): Promise<GallerySearchSnapshot>;
  get(id: string,offset?: number,relevance?: GallerySearchRelevance): Promise<GallerySearchSnapshot>;
  cancel(id: string): Promise<unknown>;
}
/** Lives with the app shell, so leaving the gallery doesn't lose the current search. */
export class GalleryPictureSearchController {
  state: PictureSearchState={mode:"picture",draft:"",snapshot:null,pending:false,error:"",relevance:"relevant"};
  #generation=0;
  #command=false;
  #fetching: symbol | null=null;
  #fetchGeneration=-1;
  constructor(private host: PictureSearchHost,private changed: (state: PictureSearchState)=>void) {}
  #publish(patch: Partial<PictureSearchState>) {this.state={...this.state,...patch};this.changed(this.state);}
  draft(value: string) {if(!value.trim()&&this.state.snapshot)this.clear();this.#publish({draft:value,error:""});}
  mode(mode: PictureSearchState["mode"]) {if(mode!==this.state.mode){this.clear();this.#publish({mode});}}
  clear() {
    ++this.#generation;
    const snapshot=this.state.snapshot;
    this.#publish({snapshot:null,error:"",draft:"",relevance:"relevant",...(!this.#command?{pending:false}:{})});
    if(pictureSearchRunning(snapshot))void this.host.cancel(snapshot!.progress.id).catch(()=>{});
  }
  async search(query: WorkQuery) {
    const text=this.state.draft.trim();
    if(!text||this.#command||pictureSearchRunning(this.state.snapshot))return;
    this.#command=true;const generation=++this.#generation;
    this.#publish({pending:true,error:"",snapshot:null,relevance:"relevant"});
    try {
      const snapshot=await this.host.start(text,pictureSearchFilters(query));
      if(generation===this.#generation)this.#publish({snapshot});
      else if(pictureSearchRunning(snapshot))await this.host.cancel(snapshot.progress.id).catch(()=>{});
    }catch(error){if(generation===this.#generation)this.#publish({error:message(error)});}
    finally {this.#command=false;this.#publish({pending:false});}
  }
  async refresh(more=false) {
    const snapshot=this.state.snapshot;
    if(!snapshot||this.#fetching&&this.#fetchGeneration===this.#generation||more&&pictureSearchRunning(snapshot))return;
    const fetching=Symbol(),generation=this.#generation,relevance=this.state.relevance;
    this.#fetching=fetching;this.#fetchGeneration=generation;
    if(more)this.#publish({pending:true});
    try {
      const lastOffset=more?snapshot.result.offset+snapshot.result.limit:snapshot.result.offset;
      let next=snapshot;const items=more?[...snapshot.result.items]:[];
      const seen=new Set(items.map(work=>work.id));
      for(let offset=more?lastOffset:0;offset<=lastOffset;offset+=60){
        next=await this.host.get(snapshot.progress.id,offset,relevance);
        if(generation!==this.#generation||this.state.snapshot?.progress.id!==snapshot.progress.id)return;
        for(const work of next.result.items)if(!seen.has(work.id)){seen.add(work.id);items.push(work);}
        if(!next.result.hasMore)break;
      }
      next.result.items=items;
      this.#publish({snapshot:next,error:""});
    }catch(error){if(generation===this.#generation)this.#publish({error:message(error)});}
    finally{if(this.#fetching===fetching)this.#fetching=null;if(more&&generation===this.#generation)this.#publish({pending:false});}
  }
  async setRelevance(relevance: GallerySearchRelevance) {
    const snapshot=this.state.snapshot;
    if(!snapshot||this.#command||relevance===this.state.relevance)return;
    const generation=++this.#generation;
    // Reset pagination and hide the old range immediately; a late poll must not restore it.
    this.#publish({relevance,pending:true,error:"",snapshot:{...snapshot,result:{...snapshot.result,items:[],offset:0,hasMore:false}}});
    try{await this.refresh();}finally{if(generation===this.#generation)this.#publish({pending:false});}
  }
  async cancel() {
    const snapshot=this.state.snapshot;if(!snapshot||this.#command)return;
    this.#command=true;const generation=this.#generation;this.#publish({pending:true,error:""});
    try{await this.host.cancel(snapshot.progress.id);if(generation===this.#generation)await this.refresh();}
    catch(error){if(generation===this.#generation)this.#publish({error:message(error)});}
    finally{this.#command=false;this.#publish({pending:false});}
  }
}
function message(error: unknown){return error instanceof Error?error.message:"找图失败，请重试";}
