import { useEffect, useRef, useState } from "react";
import type { AnalysisScope, CollectionRecord, ImageTarget, LocalImportBatch, SemanticAvailability, WorkbenchItem, WorkbenchSnapshot, WorkbenchSource } from "@sanctuary/domain";
import { Button } from "./Button";
import { SegmentedControl } from "./SegmentedControl";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { ExportImagesButton, SingleImageActions } from "./ImageOutputActions";
import { workbenchQuery } from "./workbench-query";
import { WorkbenchRemoval } from "./WorkbenchRemoval";

const ELEMENTS=[ ["单人","solo"],["多位女孩","multiple_girls"],["蓝发","blue_hair"],["金发","blonde_hair"],["眼镜","glasses"],
  ["猫耳","cat_ears"],["海边","beach"],["天空","sky"],["夜晚","night"],["血迹","blood"],["单色","monochrome"],["线稿","lineart"] ] as const;
type Filter="matches"|"all"|"failed";
export function ImageWorkbench({source,scope,collections,onChanged,onImportPrepared,onOpenProtection,onDiscuss,disabled=false}:{disabled?:boolean;source:WorkbenchSource;scope:AnalysisScope;collections:CollectionRecord[];onChanged:()=>Promise<void>;onImportPrepared:(batch:LocalImportBatch,discuss?:boolean)=>void;onDiscuss?:((targets:ImageTarget[])=>Promise<void>)|undefined;onOpenProtection:()=>void}) {
  const [session,setSession]=useState<WorkbenchSnapshot|null>(null),[items,setItems]=useState<WorkbenchItem[]>([]);
  const [text,setText]=useState("");
  const [elements,setElements]=useState<Record<string,"include"|"exclude">>({}),[customInclude,setCustomInclude]=useState(""),[customExclude,setCustomExclude]=useState("");
  const [recursive,setRecursive]=useState(false),[filter,setFilter]=useState<Filter>("all"),[selected,setSelected]=useState<Map<string,ImageTarget>>(new Map());
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[availability,setAvailability]=useState<SemanticAvailability|null>(null),[selectedPreview,setSelectedPreview]=useState<WorkbenchItem|null>(null);
  const [album,setAlbum]=useState(""),[notice,setNotice]=useState("");
  const alive=useRef(true),generation=useRef(0),pending=useRef(false),composing=useRef(false);
  const query=workbenchQuery(text,elements,customInclude,customExclude),mode=query.mode;
  const scopeKey=JSON.stringify(scope),running=session?.phase==="scanning"||session?.phase==="analyzing";
  const stale=source==="library"&&!!session&&JSON.stringify(session.scope)!==scopeKey;
  const visibleItems=stale?[]:items;
  useEffect(()=>{setSelected(new Map());setSelectedPreview(null);},[scopeKey]);
  useEffect(()=>{
    alive.current=true;const request=++generation.current;
    void Promise.all([window.sanctuary.currentWorkbench(source),window.sanctuary.semanticAvailability()]).then(async([current,a])=>{
      if(!alive.current||request!==generation.current)return;
      const s=current??(source==="library"&&!disabled?await window.sanctuary.chooseWorkbenchLibrary(scope):null);
      if(alive.current&&request===generation.current){setAvailability(a);setSession(s);setItems(s?.items??[]);if(s?.query){setFilter("matches");void window.sanctuary.getWorkbench(s.id,0,"matches").then(next=>{if(alive.current&&request===generation.current){setSession(next);setItems(next.items);}}).catch(e=>{if(alive.current&&request===generation.current)setError(message(e));});setText(s.query.text);
        const restored:Record<string,"include"|"exclude">={};s.query.include.forEach(t=>restored[t]="include");s.query.exclude.forEach(t=>restored[t]="exclude");setElements(restored);}
      }
    }).catch(e=>{if(alive.current&&request===generation.current)setError(message(e));});
    return()=>{alive.current=false;generation.current++;};
  },[source]);
  useEffect(()=>{
    if(!session||!running||busy)return;
    let active=true,timer:number;const request=generation.current;
    const poll=async()=>{try{const next=await window.sanctuary.getWorkbench(session.id,0,filter);if(!active||request!==generation.current)return;
      setSession(next);setItems(next.items);if(next.phase==="scanning"||next.phase==="analyzing")timer=window.setTimeout(()=>void poll(),700);
    }catch(e){if(active&&request===generation.current)setError(message(e));}};
    timer=window.setTimeout(()=>void poll(),100);return()=>{active=false;clearTimeout(timer);};
  },[session?.id,session?.phase,running,filter,busy]);
  async function discuss() {
    if (pending.current || stale || !selected.size || selected.size > 4) return;
    pending.current=true;setBusy(true);setError("");const request=++generation.current;
    try {
      if(source==="folder") {
        const batch=await window.sanctuary.prepareWorkbenchImport(session!.id,[...selected.keys()]);
        if(alive.current&&request===generation.current&&batch)onImportPrepared(batch,true);
      } else await onDiscuss?.([...selected.values()]);
    } catch(e) { if(alive.current&&request===generation.current)setError(message(e)); }
    finally {pending.current=false;if(alive.current&&request===generation.current)setBusy(false);}
  }
  async function command(action:"choose"|"start"|"cancel"|"import"|"more"|"filter",nextFilter=filter) {
    if(pending.current)return;pending.current=true;setBusy(true);setError("");const request=++generation.current;
    try {
      if(action==="import"){
        const batch=await window.sanctuary.prepareWorkbenchImport(session!.id,[...selected.keys()]);
        if(alive.current&&request===generation.current&&batch)onImportPrepared(batch);
      }else{
        let next:WorkbenchSnapshot|null=null;
        if(action==="choose")next=source==="folder"?await window.sanctuary.chooseWorkbenchFolder(recursive):await window.sanctuary.chooseWorkbenchLibrary(scope);
        if(action==="start"){
          next=source==="library"&&(!session||stale)?await window.sanctuary.runLibraryWorkbench(scope,query):await window.sanctuary.startWorkbench(session!.id,query);
          nextFilter="matches";
        }
        if(action==="cancel")next=await window.sanctuary.cancelWorkbench(session!.id);
        if(action==="more"||action==="filter")next=await window.sanctuary.getWorkbench(session!.id,action==="more"?items.length:0,nextFilter);
        if(alive.current&&request===generation.current&&next){setSession(next);setFilter(nextFilter);setItems(current=>action==="more"?[...current,...next!.items]:next!.items);
          if(action==="choose"||action==="start"||action==="filter"){setSelected(new Map());setSelectedPreview(null);}}
      }
    }catch(e){if(alive.current&&request===generation.current)setError(message(e));}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  function toggle(item:WorkbenchItem) {
    setSelected(current=>{const next=new Map(current);if(next.has(item.id))next.delete(item.id);else if(next.size<500)next.set(item.id,item.target);return next;});
  }
  async function assign() {
    if(pending.current||stale||!session||!album)return;pending.current=true;setBusy(true);setError("");
    try{const count=await window.sanctuary.assignWorkbenchImages(session.id,[...selected.keys()],album);if(alive.current){setNotice(`已将 ${count} 张所选图片加入相册`);setSelected(new Map());}await onChanged();}
    catch(e){if(alive.current)setError(message(e));}finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  const analyzed=session?.query!==undefined,failed=session?.failed??0;
  const canStart=!disabled&&!busy&&!running&&(source==="library"||Boolean(session?.total))&&(mode!=="description"||Boolean(availability?.available));
  const startLabel=mode==="rules"?"按探索规则排查":"开始找图";
  return <section className="image-workbench" aria-label={source==="folder"?"本地文件夹找图":"图库自然语言找图"}>
    <div className="image-workbench-controls">
      {source==="folder"&&<div className="workbench-folder-choice"><Button busy={busy} disabled={running} onClick={()=>void command("choose")}>{session?"更换文件夹":"选择图片文件夹"}</Button>
        <label><input type="checkbox" checked={recursive} disabled={running||busy} onChange={event=>setRecursive(event.target.checked)}/>包括子文件夹</label>
        <p>{session?`${session.name} · ${session.total} 张图片` : "只预览，不会自动导入或移动原图。"}</p></div>}
      <form className="workbench-request" onSubmit={event=>{event.preventDefault();if(!composing.current&&canStart)void command("start");}}>
        <label className="organize-field">想找什么？<input aria-label="画面描述" maxLength={500} placeholder="例如：海边的蓝发女孩；留空则按探索规则排查" value={text} disabled={running||busy}
          onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onChange={event=>setText(event.target.value)}/></label>
        <Button type="submit" variant="primary" busy={busy} disabled={!canStart}>{startLabel}</Button>
        {running&&<Button size="small" variant="ghost" disabled={busy||session?.cancelRequested} onClick={()=>void command("cancel")}>{session?.cancelRequested?"正在停止…":"停止分析"}</Button>}
      </form>
      <p>{mode==="rules"?"默认使用探索的元素规则，留空时找出需要关注的图片。":mode==="description"?"按画面内容找图，首次自动建立索引，之后复用。":"按附加元素条件筛选。"} {source==="library"&&!session?"选择范围后直接开始，无需手动载入。":""}</p>
      {stale&&<p role="status">范围已变化，点“{startLabel}”会自动按新范围重新查找。</p>}
      {session&&<p role="status">{phaseLabel(session)} · 已处理 {session.processed} / {session.total} 张{failed?` · 失败 ${failed} 张`:""}{session.unanalysed?` · 未分析 ${session.unanalysed} 张`:""}</p>}
      {(error||session?.error)&&<p role="alert">{error||session?.error}</p>}
      {mode==="description"&&availability&&!availability.available&&<p role="alert">{availability.message}</p>}
      <SettingsDisclosure title="附加筛选条件" description={query.include.length+query.exclude.length?`已附加 ${query.include.length+query.exclude.length} 条条件`:"需要或排除元素、查看探索规则。"} name="workbench-elements">
        <p>点击元素，在“不限 → 需要 → 排除”之间切换。多个需要条件须同时满足。</p>
        <div className="workbench-elements">{ELEMENTS.map(([label,tag])=><button key={tag} type="button" disabled={running||busy} aria-pressed={!!elements[tag]} data-condition={elements[tag]??"any"}
          onClick={()=>setElements(current=>{const next={...current};if(!next[tag])next[tag]="include";else if(next[tag]==="include")next[tag]="exclude";else delete next[tag];return next;})}>{label} · {elements[tag]==="include"?"需要":elements[tag]==="exclude"?"排除":"不限"}</button>)}</div>
        <details><summary>更多识别标签与说明</summary><label className="organize-field">需要包含<input aria-label="需要包含标签" placeholder="英文标签，逗号分隔" value={customInclude} disabled={running||busy} onChange={event=>setCustomInclude(event.target.value)}/></label>
          <label className="organize-field">不要包含<input aria-label="不要包含标签" value={customExclude} disabled={running||busy} onChange={event=>setCustomExclude(event.target.value)}/></label><p>明确元素使用当前识别模型的 40% 检出阈值；相似度不表示识别正确率。失败与未分析不等于“不含”。</p></details>
        <Button size="small" variant="ghost" disabled={running} onClick={onOpenProtection}>在探索调整规则</Button>
      </SettingsDisclosure>
      {query.include.length+query.exclude.length>0&&<p>当前附加：{query.include.map(tag=>`需要 ${ELEMENTS.find(([,value])=>value===tag)?.[0]??tag}`).join("、")}{query.exclude.length?` · 排除 ${query.exclude.map(tag=>ELEMENTS.find(([,value])=>value===tag)?.[0]??tag).join("、")}`:""}</p>}
      {session?.warnings.map((warning,index)=><p key={index} role="status">{warning}</p>)}
      {notice&&<p role="status">{notice}</p>}
    </div>
    <div className="image-workbench-results">
      <header><h2>{analyzed?`查找结果 · ${session?.matched??0} 张`:`图片预览 · ${session?.total??0} 张`}</h2>
        {session?.query&&<p>结果来自上次查找：{session.query.mode==="description"?session.query.text:session.query.mode==="rules"?"探索元素规则":"明确元素条件"}{session.query.include.length?` · 需要 ${session.query.include.map(tag=>ELEMENTS.find(([,value])=>value===tag)?.[0]??tag).join("、")}`:""}{session.query.exclude.length?` · 排除 ${session.query.exclude.map(tag=>ELEMENTS.find(([,value])=>value===tag)?.[0]??tag).join("、")}`:""}</p>}
        {session&&analyzed&&!stale&&<SegmentedControl label="图片结果范围" value={filter} options={[{value:"matches",label:session.query?.mode==="description"?"较相关结果":"匹配结果"},{value:"all",label:"全部图片"},...(failed?[{value:"failed",label:`读取失败 ${failed}`}]:[])]} onChange={v=>{if(!busy&&!running)void command("filter",v as Filter);}}/>}
        {session?.query?.mode==="description"&&!running&&session.matched<session.processed-session.failed&&filter==="matches"&&<p>默认收起较低相关性的图片，切换“全部图片”即可查看，无需重新分析。</p>}
      </header>
      {!session&&<p className="image-workbench-empty">{source==="folder"?"选择图片文件夹即可开始，不必先导入图库。":"在上方描述想找的画面，或留空直接按探索规则排查。"}</p>}
      {session&&!visibleItems.length&&<p className="image-workbench-empty">{stale?"范围已变化，请按新范围重新查找。":running?"正在准备图片与模型，请稍候…":filter==="failed"?"没有分析失败的图片。":!analyzed?"这个范围没有找到支持的图片。":"当前没有匹配结果。可以换种描述或查看全部图片；未分析和失败不等于不含某元素。"}</p>}
      {!!visibleItems.length&&<div className="workbench-result-toolbar"><Button size="small" disabled={busy||running} onClick={()=>setSelected(current=>{const next=new Map(current);for(const item of visibleItems)if(next.size<500)next.set(item.id,item.target);return next;})}>选择当前展示的图片</Button>
        <Button size="small" variant="ghost" disabled={running||!selected.size} onClick={()=>setSelected(new Map())}>取消选择</Button><span>已选 {selected.size} / 500 张 · 操作仅针对所选页</span></div>}
      <div className="workbench-image-grid">{visibleItems.map(item=><article key={item.id} className={selected.has(item.id)?"selected":""}>
        <label><input type="checkbox" aria-label={`选择 ${item.title}`} checked={selected.has(item.id)} disabled={running||busy||!selected.has(item.id)&&selected.size>=500} onChange={()=>toggle(item)}/><img src={item.previewUrl} alt={item.title} loading="lazy" decoding="async"/></label>
        <strong title={item.title}>{item.title}</strong><small>{item.status==="failed"?item.error:item.status==="pending"?"尚未分析":item.score!==undefined?"按画面相似程度排列":item.matched?"符合条件":"未匹配条件"}</small>
        <Button size="small" variant="ghost" disabled={running} onClick={()=>setSelectedPreview(current=>current?.id===item.id?null:item)}>取用此图</Button>
      </article>)}</div>
      {selectedPreview&&<section className="workbench-single-output" aria-label="取用所选单图"><strong>{selectedPreview.title}</strong><SingleImageActions target={selectedPreview.target}/><ExportImagesButton targets={[selectedPreview.target]} label="复制这页原图"/><Button size="small" variant="ghost" onClick={()=>setSelectedPreview(null)}>收起</Button></section>}
      {session?.hasMore&&!stale&&<Button disabled={busy||running} onClick={()=>void command("more")}>再显示 60 张</Button>}
      {session&&!stale&&<section className="workbench-result-actions" aria-label="取用筛选结果"><ExportImagesButton targets={[...selected.values()]} disabled={running||busy}/>
        {source==="folder"&&<Button variant="primary" disabled={running||busy||!selected.size} onClick={()=>void command("import")}>导入所选图片…</Button>}
        {source==="library"&&<><select aria-label="找图结果相册" value={album} disabled={running||busy} onChange={e=>setAlbum(e.target.value)}><option value="">选择相册…</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><Button disabled={running||busy||!album||!selected.size} onClick={()=>void assign()}>加入相册</Button></>}
        {onDiscuss&&<Button disabled={running||busy||!selected.size||selected.size>4} onClick={()=>void discuss()}>{source==="folder"?"导入后讨论所选图片…":"聊聊所选图片"}</Button>}
        <p>复制保留原图，同名自动另存；讨论最多选择 4 张图，文件夹图片先确认导入。</p></section>}
      {source==="library"&&session&&!stale&&selected.size>0&&<WorkbenchRemoval targets={[...selected.values()]} disabled={running||busy} onRemoved={async message=>{setNotice(message);setSelected(new Map());setSelectedPreview(null);try{await onChanged();}catch{setError("作品已处理，但刷新图库失败，请返回图库后重试刷新。");}await command("filter");}}/>}
    </div>
  </section>;
}
function phaseLabel(s:WorkbenchSnapshot){return s.phase==="scanning"?`正在扫描（已查看 ${s.visited} 个目录项）`:s.phase==="analyzing"?s.processed?"正在分析":"正在准备模型与分析":s.phase==="completed"?"分析已结束":s.phase==="cancelled"?"已停止，保留完成结果":s.phase==="failed"?"任务失败，可重试":"可以开始分析";}
function message(e:unknown){return e instanceof Error?e.message:"操作失败，请重试";}
