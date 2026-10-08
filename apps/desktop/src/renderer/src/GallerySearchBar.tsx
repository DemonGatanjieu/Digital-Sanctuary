import { useRef } from "react";
import type { WorkQuery } from "@sanctuary/domain";
import { Button } from "./Button";
import type { GalleryPictureSearch } from "./useGalleryPictureSearch";
import { pictureSearchScopeKey } from "./gallery-picture-search";

export function GallerySearchBar({search,query,onQueryChange}:{search:GalleryPictureSearch;query:WorkQuery;onQueryChange:(query:WorkQuery)=>void}) {
  const composing=useRef(false),p=search.snapshot?.progress;
  const stale=Boolean(p&&pictureSearchScopeKey(p.galleryQuery??{})!==pictureSearchScopeKey(query));
  const description=search.mode==="picture";
  function submit(){if(description)void search.search();}
  function clear(){search.clear();const {search:_search,...rest}=query;onQueryChange({...rest,offset:0});}
  return <section className="gallery-search" aria-label="搜索图库">
    <form className="gallery-search-form" onSubmit={event=>{event.preventDefault();if(!composing.current)submit();}}>
      <select aria-label="搜索方式" value={search.mode} onChange={event=>{
        const value=event.target.value as "picture"|"name",draft=description?search.draft:query.search??"";
        search.setMode(value);search.setDraft(draft);
        const {search:_search,...rest}=query;onQueryChange({...rest,...(value==="name"&&draft?{search:draft}:{}),offset:0});
      }}><option value="picture">搜画面</option><option value="name">搜名称 / 画师</option></select>
      <label className="work-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="搜索图库" maxLength={description?500:200}
        value={description?search.draft:query.search??""} placeholder={description?"用中文描述画面，例如：海边穿白裙的女孩":"搜索标题、作者或 Pixiv ID"}
        onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}
        onChange={event=>description?search.setDraft(event.target.value):onQueryChange({...query,search:event.target.value,offset:0})}/></label>
      {description&&<Button variant="primary" type="submit" disabled={!search.draft.trim()||search.running||search.pending} busy={search.pending} busyLabel="准备中…">找图</Button>}
      {(description?Boolean(search.draft||p||search.error):Boolean(query.search))&&<Button variant="ghost" disabled={search.pending} onClick={clear}>清除</Button>}
    </form>
    {description&&<div className="gallery-search-feedback" aria-live="polite">
      {!p&&!search.pending&&!search.error&&<p>直接用中文找图。首次自动建立本地索引，之后复用；图片不会移动或修改。</p>}
      {search.pending&&!p&&<p role="status">正在准备搜索…</p>}
      {p&&<>
        <p role="status">{p.phase==="scanning"?`正在读取图库图片 · 已找到 ${p.total} 张`:p.phase==="analyzing"?p.processed?`正在建立或复用索引 · ${p.processed} / ${p.total} 张`:`正在准备找图模型 · 首次加载较慢，请稍候`:p.phase==="cancelled"?`已停止 · 保留 ${p.processed} 张已处理图片的索引和结果`:p.phase==="failed"?"这次找图没有完成":p.total===0?"当前筛选范围没有可搜索的图片":`已搜索 ${p.processed} 张图片 · 按画面相似程度排列`}{p.failed?` · ${p.failed} 张读取失败`:""}</p>
        {search.running&&<Button size="small" variant="ghost" disabled={search.pending||p.cancelRequested} onClick={()=>void search.cancel()}>{p.cancelRequested?"正在停止…":"停止找图"}</Button>}
        {p.query&&search.draft.trim()!==p.query.text&&<p>当前结果来自“{p.query.text}”，输入新描述后点“找图”。</p>}
        {stale&&<p role="status">筛选范围已变化，旧结果已收起。{search.running?"请先停止，再按新范围找图。":"点“找图”搜索当前范围。"}</p>}
        {p.warnings.map((warning,index)=><p key={index}>{warning}</p>)}
        {p.failed>0&&!search.running&&<p>无法读取的图片未参与排序；检查外部原图位置后，可点“找图”重试，已完成索引会复用。</p>}
      </>}
      {(search.error||p?.error)&&<p role="alert">{search.error||p?.error}。可重新找图，或切换“搜名称 / 画师”。</p>}
    </div>}
  </section>;
}
