import { describe,expect,it,vi } from "vitest";
import type { GallerySearchSnapshot,GallerySearchRelevance,WorkListItem } from "@sanctuary/domain";
import { GalleryPictureSearchController,pictureSearchScopeKey,type PictureSearchState } from "./gallery-picture-search";
function snapshot(id="search",phase="completed",ids=["a"]): GallerySearchSnapshot {return {
  progress:{id,source:"library",name:"中文",recursive:false,phase:phase as "completed",galleryQuery:{},total:1,processed:1,failed:0,matched:1,unanalysed:0,visited:0,limitReached:false,warnings:[],items:[],hasMore:false,cancelRequested:false},
  result:{items:ids.map(id=>({id} as WorkListItem)),total:100,totalPages:100,offset:0,limit:60,hasMore:true},
  relevance:{mode:"relevant",minimumScore:.65,hiddenWorks:5,hiddenPages:5}
};}
function fixture(){const host={start:vi.fn(async()=>snapshot()),get:vi.fn(async(_id:string,_offset?:number,_relevance?:GallerySearchRelevance)=>snapshot()),cancel:vi.fn(async()=>{})};return {host,controller:new GalleryPictureSearchController(host,vi.fn())};}
describe("gallery picture search concurrency",()=>{
  it("starts with one description, strips title search and pagination, and retains useful filters",async()=>{
    const {host,controller}=fixture();controller.draft("海边白裙女孩");await controller.search({search:"旧标题",ownership:"external",favorite:true,offset:60,limit:60,sortBy:"title"});
    expect(host.start).toHaveBeenCalledWith("海边白裙女孩",{ownership:"external",favorite:true});
    expect(controller.state.mode).toBe("picture");expect(controller.state.snapshot?.result.items[0]?.id).toBe("a");
    expect(pictureSearchScopeKey({ownership:"external",offset:60})).toBe(pictureSearchScopeKey({ownership:"external",offset:0,sortBy:"title"}));
    expect(pictureSearchScopeKey({ownership:"managed"})).not.toBe(pictureSearchScopeKey({ownership:"external"}));
    // The main process echoes element conditions back with their resolution attached; that is the same scope.
    const elements={include:["sky"]};
    expect(pictureSearchScopeKey({elements,elementMatch:{engine:"wd",include:[{tag:"sky",minimum:.4}],exclude:[],anyOf:[]}})).toBe(pictureSearchScopeKey({elements}));
    expect(pictureSearchScopeKey({elements})).not.toBe(pictureSearchScopeKey({elements:{exclude:["sky"]}}));
  });
  it("cancels a search that starts after the user clears or switches to name search",async()=>{
    const {host,controller}=fixture();let release!:(v:GallerySearchSnapshot)=>void;host.start.mockImplementationOnce(()=>new Promise(done=>{release=done;}));
    controller.draft("旧描述");const pending=controller.search({});controller.mode("name");release(snapshot("old","analyzing"));await pending;
    expect(controller.state.snapshot).toBeNull();expect(host.cancel).toHaveBeenCalledWith("old");expect(controller.state.pending).toBe(false);
  });
  it("ignores late polls after clearing and serializes pagination",async()=>{
    const {host,controller}=fixture();controller.draft("画面");await controller.search({});let release!:(v:GallerySearchSnapshot)=>void;
    host.get.mockImplementationOnce(()=>new Promise(done=>{release=done;}));const more=controller.refresh(true);await controller.refresh(true);expect(host.get).toHaveBeenCalledTimes(1);
    controller.clear();release(snapshot("search","completed",["old"]));await more;expect(controller.state.snapshot).toBeNull();
    controller.draft("新画面");await controller.search({});host.get.mockResolvedValueOnce({...snapshot("search","completed",["a","b"]),result:{...snapshot().result,offset:60,items:[{id:"a"},{id:"b"}] as WorkListItem[]}});
    await controller.refresh(true);expect(controller.state.snapshot?.result.items.map(work=>work.id)).toEqual(["a","b"]);
  });
  it("revalidates all loaded pages after a return or mutation instead of dropping back to the first page",async()=>{
    const {host,controller}=fixture();controller.draft("画面");await controller.search({});
    host.get.mockResolvedValueOnce({...snapshot("search","completed",["b"]),result:{...snapshot().result,offset:60,items:[{id:"b"}] as WorkListItem[]}});
    await controller.refresh(true);
    host.get.mockResolvedValueOnce(snapshot("search","completed",["renamed-a"])).mockResolvedValueOnce({...snapshot("search","completed",["b"]),result:{...snapshot().result,offset:60,items:[{id:"b"}] as WorkListItem[]}});
    await controller.refresh();expect(host.get.mock.calls.slice(-2)).toEqual([["search",0,"relevant"],["search",60,"relevant"]]);
    expect(controller.state.snapshot?.result.items.map(work=>work.id)).toEqual(["renamed-a","b"]);
  });
  it("keeps model failures actionable and retries without repeating UI preparation",async()=>{
    const {host,controller}=fixture();host.start.mockRejectedValueOnce(new Error("模型未准备"));controller.draft("中文画面");await controller.search({});
    expect(controller.state.error).toBe("模型未准备");expect(controller.state.draft).toBe("中文画面");expect(controller.state.pending).toBe(false);
    await controller.search({});expect(controller.state.error).toBe("");expect(controller.state.snapshot).not.toBeNull();
  });
  it("expands the existing search without encoding again, resets pagination and restores the default on a new query",async()=>{
    const {host,controller}=fixture();controller.draft("画面");await controller.search({});
    host.get.mockResolvedValueOnce({...snapshot("search","completed",["b"]),result:{...snapshot().result,offset:60,items:[{id:"b"}] as WorkListItem[]}});
    await controller.refresh(true);
    host.get.mockResolvedValueOnce({...snapshot("search","completed",["a","weak"]),relevance:{...snapshot().relevance,mode:"all",hiddenWorks:0,hiddenPages:0}});
    await controller.setRelevance("all");
    expect(host.get).toHaveBeenLastCalledWith("search",0,"all");expect(host.start).toHaveBeenCalledTimes(1);
    expect(controller.state.snapshot?.result.items.map(work=>work.id)).toEqual(["a","weak"]);expect(controller.state.pending).toBe(false);
    await controller.setRelevance("relevant");expect(host.get).toHaveBeenLastCalledWith("search",0,"relevant");
    await controller.setRelevance("all");controller.draft("新画面");await controller.search({});expect(controller.state.relevance).toBe("relevant");
  });
  it("does not let an older poll or page overwrite a newly selected relevance range",async()=>{
    const {host,controller}=fixture();controller.draft("画面");await controller.search({});let release!:(v:GallerySearchSnapshot)=>void;
    host.get.mockImplementationOnce(()=>new Promise(done=>{release=done;}));const older=controller.refresh(true);
    host.get.mockResolvedValueOnce({...snapshot("search","completed",["all-result"]),relevance:{...snapshot().relevance,mode:"all"}});
    await controller.setRelevance("all");release(snapshot("search","completed",["old-filtered-result"]));await older;
    expect(controller.state.snapshot?.result.items.map(work=>work.id)).toEqual(["all-result"]);
    expect(controller.state.relevance).toBe("all");expect(controller.state.pending).toBe(false);
    await controller.refresh();expect(host.get).toHaveBeenLastCalledWith("search",0,"all");
  });
  it("starts a likeness search from one page, replacing a running description search",async()=>{
    const host={start:vi.fn(async()=>snapshot("described","analyzing")),startSimilar:vi.fn(async()=>snapshot("similar")),get:vi.fn(),cancel:vi.fn(async()=>undefined)};
    const states:PictureSearchState[]=[];const c=new GalleryPictureSearchController(host,state=>states.push(state));
    c.draft("夜晚");await c.search({favorite:true});
    await c.similar({workId:"local:1",assetId:"a1",title:"雨夜"},{favorite:true,search:"标题",sortBy:"title"});
    expect(host.cancel).toHaveBeenCalledWith("described");
    expect(host.startSimilar).toHaveBeenCalledWith("local:1","a1",{favorite:true});
    expect(c.state).toMatchObject({mode:"picture",draft:"相似：雨夜",pending:false});
    expect(c.state.snapshot?.progress.id).toBe("similar");
  });
  it("does nothing for likeness when the host cannot do it",async()=>{
    const host={start:vi.fn(),get:vi.fn(),cancel:vi.fn()};const c=new GalleryPictureSearchController(host,()=>{});
    await c.similar({workId:"w",assetId:"a",title:"t"},{});expect(c.state.draft).toBe("");
  });
});

