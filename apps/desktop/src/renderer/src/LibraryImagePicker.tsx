import { useEffect, useRef, useState } from "react";
import type { WorkAssetRecord, WorkListItem, WorkRecord } from "@sanctuary/domain";
import { LibraryQueryController, type LibraryQueryState } from "./library-query-controller";
import { Button } from "./Button";
import { DialogOverlay, isDialogComposition } from "./DialogOverlay";

export type LibraryImageChoice = {workId:string;assetId:string};
export function LibraryImagePicker({onClose,onSelect}:{onClose:()=>void;onSelect:(target:LibraryImageChoice)=>Promise<void>}) {
  const [state,setState]=useState<LibraryQueryState|null>(null),[search,setSearch]=useState("");
  const [work,setWork]=useState<WorkRecord|null>(null),[asset,setAsset]=useState<WorkAssetRecord|null>(null);
  const [error,setError]=useState(""),[opening,setOpening]=useState(false),[saving,setSaving]=useState(false),[pageLimit,setPageLimit]=useState(60);
  const alive=useRef(false),generation=useRef(0),locked=useRef(false),controller=useRef<LibraryQueryController|null>(null);
  useEffect(()=>{
    alive.current=true;
    const query=new LibraryQueryController(q=>window.sanctuary.queryWorks(q),next=>{if(alive.current)setState(next);},cause=>{if(alive.current)setError(message(cause));});
    controller.current=query;void query.refresh();
    return()=>{alive.current=false;++generation.current;query.invalidate();};
  },[]);
  useEffect(()=>{
    const query=controller.current;if(!query)return;
    if(!query.changeQuery({...query.state.query,search}))return;
    setError("");++generation.current;
    const timer=setTimeout(()=>void query.refresh(),search.trim()?180:0);
    return()=>clearTimeout(timer);
  },[search]);
  async function open(item:WorkListItem){
    if(locked.current)return;locked.current=true;setOpening(true);setError("");const request=++generation.current;
    try{
      const next=await window.sanctuary.getWork(item.id);if(!alive.current||request!==generation.current)return;
      if(!next)throw new Error("这件作品已不在图库中，请换一张");
      const pages=next.assets.filter(readable);if(!pages.length)throw new Error("这件作品没有可用的图片");
      setWork(next);setAsset(pages.length===1?pages[0]!:null);setPageLimit(60);
    }catch(cause){if(alive.current&&request===generation.current)setError(message(cause));}
    finally{locked.current=false;if(alive.current)setOpening(false);}
  }
  async function confirm(){
    if(locked.current||!work||!asset)return;locked.current=true;setSaving(true);setError("");
    try{await onSelect({workId:work.id,assetId:asset.id});if(alive.current)onClose();}
    catch(cause){if(alive.current)setError(message(cause));}
    finally{locked.current=false;if(alive.current)setSaving(false);}
  }
  const pages=work?.assets.filter(readable)??[],items=state?.result.items.filter(item=>item.coverAsset&&readable(item.coverAsset))??[],loading=state?.loading??true;
  return <DialogOverlay busy={saving||opening} onClose={onClose}>
    <section className="dialog-surface library-image-picker" role="dialog" aria-modal="true" aria-label="从图库选择图片"
      onKeyDown={event=>{if(event.key!=="Tab")event.stopPropagation();if(event.key==="Escape"&&!isDialogComposition(event.nativeEvent)){event.preventDefault();if(!saving&&!opening)onClose();}}}>
      <header><div><h2>{work?"选择具体一页":"从图库选择图片"}</h2><p>{work?work.title:"按作品名称或画师搜索，选好后确认使用。"}</p></div>
        <Button variant="ghost" disabled={saving||opening} aria-label="关闭图片选择器" onClick={onClose}>×</Button></header>
      {work?<Button size="small" variant="ghost" disabled={saving} onClick={()=>{setWork(null);setAsset(null);setError("");}}>← 返回作品列表</Button>
        :<input type="search" autoFocus aria-label="搜索图库图片" placeholder="搜索名称、画师或作品 ID" maxLength={200} value={search} disabled={opening||saving} onChange={event=>setSearch(event.target.value)}/>}
      {error&&<p role="alert">{error}</p>}
      {!work&&loading&&<p role="status">正在读取图库…</p>}
      <div className="library-image-picker-grid" aria-busy={loading||opening||saving}>
        {work?pages.slice(0,pageLimit).map(page=><button type="button" key={page.id} disabled={saving} aria-pressed={asset?.id===page.id} aria-label={`选择第 ${page.pageIndex+1} 页`} onClick={()=>setAsset(page)}>
          <img src={imageUrl(page.thumbnailPath??page.path)} alt="" loading="lazy" decoding="async"/><strong>第 {page.pageIndex+1} 页</strong></button>)
          :items.map(item=><button type="button" key={item.id} disabled={loading||opening||saving} onClick={()=>void open(item)} aria-label={`选择作品 ${item.title}`}>
            <img src={imageUrl(item.coverAsset!.thumbnailPath??item.coverAsset!.path)} alt="" loading="lazy" decoding="async"/>
            <strong>{item.title}</strong><small>{item.pageCount} 页 · {item.artistName??"本地作品"}</small></button>)}
        {!work&&!loading&&!items.length&&<p>没有找到可用图片，可以换个关键词或先导入图片。</p>}
      </div>
      {!work&&error&&<Button onClick={()=>void controller.current?.refresh()}>重试读取</Button>}
      {!work&&state?.result.hasMore&&<Button disabled={state.loading||opening} onClick={()=>void controller.current?.loadMore()}>再显示 60 件作品</Button>}
      {work&&pages.length>pageLimit&&<Button onClick={()=>setPageLimit(limit=>limit+60)}>再显示 60 页</Button>}
      <footer><span>{asset?`已选《${work!.title}》第 ${asset.pageIndex+1} 页`:"选择一张图片，不会移动或修改原图。"}</span>
        <Button disabled={saving||opening} onClick={onClose}>取消</Button><Button variant="primary" disabled={!asset||opening} busy={saving} busyLabel="正在保存…" onClick={()=>void confirm()}>使用这张图片</Button></footer>
    </section>
  </DialogOverlay>;
}
function readable(asset:WorkAssetRecord){return asset.mediaType==="image"&&asset.fileState==="available";}
function imageUrl(path:string){return `sanctuary-image://local/${encodeURIComponent(path)}`;}
function message(cause:unknown){return cause instanceof Error?cause.message:"读取图片失败，请重试";}
