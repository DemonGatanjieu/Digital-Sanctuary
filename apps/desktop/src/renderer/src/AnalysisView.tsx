import { useEffect, useMemo, useState } from "react";
import type { AnalysisScope, ArtistRecord, CollectionRecord, ImageTarget, LocalImportBatch } from "@sanctuary/domain";
import type { AppStatus } from "./AppSidebar";
import { Button } from "./Button";
import { SegmentedControl } from "./SegmentedControl";
import { ImageWorkbench } from "./ImageWorkbench";
import { AlbumSuggestions } from "./AlbumSuggestions";

export function AnalysisView({collections,artists,selectedWorkIds,status,error,onApplied,onOpenProtection,initialJobId,onJobOpened,onImportPrepared,onDiscuss,initialWorkbenchSource,onWorkbenchOpened}: {
  collections:CollectionRecord[];artists:ArtistRecord[];selectedWorkIds:string[];status:AppStatus|null;error:string;
  onApplied:()=>Promise<void>;onError:(error:unknown)=>void;onOpenProtection:()=>void;onRulesChanged?:()=>Promise<void>;
  initialJobId?:string|null;onJobOpened?:()=>void;onImportPrepared:(batch:LocalImportBatch,discuss?:boolean)=>void;
  onDiscuss?:(targets:ImageTarget[])=>Promise<void>;initialWorkbenchSource?:"library"|"folder"|null;onWorkbenchOpened?:()=>void;
}) {
  const [source,setSource]=useState<"library"|"folder">(initialWorkbenchSource??"library");
  const [scopeType,setScopeType]=useState<AnalysisScope["type"]>(selectedWorkIds.length?"selected":"all");
  const [artistId,setArtistId]=useState(artists[0]?.id??""),[collectionId,setCollectionId]=useState(collections[0]?.id??"");
  const [suggestions,setSuggestions]=useState(Boolean(initialJobId||selectedWorkIds.length));
  useEffect(()=>{if(!artistId&&artists[0])setArtistId(artists[0].id);},[artists,artistId]);
  useEffect(()=>{if(!collectionId&&collections[0])setCollectionId(collections[0].id);},[collections,collectionId]);
  useEffect(()=>{if(initialWorkbenchSource){setSource(initialWorkbenchSource);onWorkbenchOpened?.();}},[initialWorkbenchSource,onWorkbenchOpened]);
  useEffect(()=>{if(initialJobId){setSource("library");setSuggestions(true);}},[initialJobId]);
  const scope=useMemo<AnalysisScope>(()=>scopeType==="selected"?{type:"selected",workIds:selectedWorkIds}:scopeType==="artist"?{type:"artist",artistId}:scopeType==="collection"?{type:"collection",collectionId}:{type:"all"},[scopeType,artistId,collectionId,selectedWorkIds]);
  const invalidScope=scopeType==="selected"&&!selectedWorkIds.length||scopeType==="artist"&&!artists.some(a=>a.id===artistId)||scopeType==="collection"&&!collections.some(c=>c.id===collectionId);
  return <div className="studio-root organize-simple organize-workbench">
    <header className="topbar studio-topbar"><div><h1>找图与整理</h1><p className="page-description">选一批图片，说出需求，再处理找到的结果。</p></div></header>
    {error&&<p role="alert">{error}</p>}
    <section className="organize-source-tools" aria-label="选择图片范围">
      <SegmentedControl label="图片来源" value={source} options={[{value:"library",label:"我的图库"},{value:"folder",label:"本地文件夹"}]} onChange={value=>setSource(value as "library"|"folder")}/>
      {source==="library"&&<>
        <label className="organize-inline-field">范围<select aria-label="整理范围" value={scopeType} onChange={event=>setScopeType(event.target.value as AnalysisScope["type"])}>
          <option value="all">全部图库</option><option value="selected" disabled={!selectedWorkIds.length}>图库已选 · {selectedWorkIds.length} 件</option>
          <option value="collection" disabled={!collections.length}>某个相册</option><option value="artist" disabled={!artists.length}>某位画师</option>
        </select></label>
        {scopeType==="collection"&&<select aria-label="整理相册" value={collectionId} onChange={event=>setCollectionId(event.target.value)}>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        {scopeType==="artist"&&<select aria-label="整理画师" value={artistId} onChange={event=>setArtistId(event.target.value)}>{artists.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>}
        <Button variant="ghost" size="small" aria-expanded={suggestions} aria-controls="album-suggestions-panel" onClick={()=>setSuggestions(value=>!value)}>{suggestions?"收起相册建议与记录":"相册建议与任务记录"}</Button>
      </>}
    </section>
    {source==="library"&&suggestions&&<div id="album-suggestions-panel"><AlbumSuggestions scope={scope} status={status} onApplied={onApplied} onOpenProtection={onOpenProtection} initialJobId={initialJobId} onJobOpened={onJobOpened}/></div>}
    <ImageWorkbench key={source} source={source} scope={scope} disabled={source==="library"&&invalidScope} collections={collections} onChanged={onApplied} onImportPrepared={onImportPrepared} onDiscuss={onDiscuss} onOpenProtection={onOpenProtection}/>
  </div>;
}
