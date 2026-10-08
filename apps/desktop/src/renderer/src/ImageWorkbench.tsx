import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AnalysisScope, CollectionRecord, ImageTarget, LocalImportBatch, SemanticAvailability, WorkbenchItem, WorkbenchMode, WorkbenchSnapshot, WorkbenchSource } from "@sanctuary/domain";
import { Button } from "./Button";
import { SegmentedControl } from "./SegmentedControl";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { ExportImagesButton, SingleImageActions } from "./ImageOutputActions";

const ELEMENTS=[ ["单人","solo"],["多位女孩","multiple_girls"],["蓝发","blue_hair"],["金发","blonde_hair"],["眼镜","glasses"],
  ["猫耳","cat_ears"],["海边","beach"],["天空","sky"],["夜晚","night"],["血迹","blood"],["单色","monochrome"],["线稿","lineart"] ] as const;
type Filter="matches"|"all"|"failed";
export function ImageWorkbench({source,scope,collections,onChanged,onImportPrepared,onOpenProtection,onDiscuss}:{source:WorkbenchSource;scope:AnalysisScope;collections:CollectionRecord[];onChanged:()=>Promise<void>;onImportPrepared:(batch:LocalImportBatch,discuss?:boolean)=>void;onDiscuss?:((targets:ImageTarget[])=>Promise<void>)|undefined;onOpenProtection:()=>void}) {
  const [session,setSession]=useState<WorkbenchSnapshot|null>(null),[items,setItems]=useState<WorkbenchItem[]>([]);
  const [mode,setMode]=useState<WorkbenchMode>(source==="library"?"description":"rules"),[text,setText]=useState("");
  const [elements,setElements]=useState<Record<string,"include"|"exclude">>({}),[customInclude,setCustomInclude]=useState(""),[customExclude,setCustomExclude]=useState("");
  const [recursive,setRecursive]=useState(false),[filter,setFilter]=useState<Filter>("all"),[selected,setSelected]=useState<Map<string,ImageTarget>>(new Map());
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[availability,setAvailability]=useState<SemanticAvailability|null>(null),[selectedPreview,setSelectedPreview]=useState<WorkbenchItem|null>(null);
  const [album,setAlbum]=useState(""),[notice,setNotice]=useState("");
  const alive=useRef(true),generation=useRef(0),pending=useRef(false),composing=useRef(false);
  const scopeKey=JSON.stringify(scope),running=session?.phase==="scanning"||session?.phase==="analyzing";
  const stale=source==="library"&&!!session&&JSON.stringify(session.scope)!==scopeKey;
  useEffect(()=>{
    alive.current=true;const request=++generation.current;
    void Promise.all([window.sanctuary.currentWorkbench(source),window.sanctuary.semanticAvailability()]).then(([s,a])=>{
      if(alive.current&&request===generation.current){setAvailability(a);setSession(s);setItems(s?.items??[]);if(s?.query){setMode(s.query.mode);setText(s.query.text);
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
    if (pending.current || !selected.size || selected.size > 4) return;
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
          const tags=(kind:"include"|"exclude",custom:string)=>[...new Set([...Object.entries(elements).filter(([,v])=>v===kind).map(([t])=>t),...custom.split(/[\s,，]+/).filter(Boolean)])];
          next=await window.sanctuary.startWorkbench(session!.id,{mode,text,include:mode==="rules"?[]:tags("include",customInclude),exclude:mode==="rules"?[]:tags("exclude",customExclude)});
          nextFilter="matches";
        }
        if(action==="cancel")next=await window.sanctuary.cancelWorkbench(session!.id);
        if(action==="more"||action==="filter")next=await window.sanctuary.getWorkbench(session!.id,action==="more"?items.length:0,nextFilter);
        if(alive.current&&request===generation.current&&next){setSession(next);setFilter(nextFilter);setItems(current=>action==="more"?[...current,...next!.items]:next!.items);
          if(action==="choose"||action==="start"){setSelected(new Map());setSelectedPreview(null);}}
      }
    }catch(e){if(alive.current&&request===generation.current)setError(message(e));}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  function toggle(item:WorkbenchItem) {
    setSelected(current=>{const next=new Map(current);if(next.has(item.id))next.delete(item.id);else if(next.size<500)next.set(item.id,item.target);return next;});
  }
  async function assign() {
    if(pending.current||!session||!album)return;pending.current=true;setBusy(true);setError("");
    try{const count=await window.sanctuary.assignWorkbenchImages(session.id,[...selected.keys()],album);if(alive.current){setNotice(`已将 ${count} 张所选图片加入相册`);setSelected(new Map());}await onChanged();}
    catch(e){if(alive.current)setError(message(e));}finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  const analyzed=session?.query!==undefined,failed=session?.failed??0;
  const analysisActions=<div className="workbench-analysis-actions">
    <Button variant="primary" disabled={busy||running||!session||!session.total||stale||mode==="description"&&(!text.trim()||!availability?.available)} onClick={()=>void command("start")}>{mode==="description"?"按描述找图":mode==="rules"?"分析并排查":"分析并筛选"}</Button>
    {session&&<p role="status">{phaseLabel(session)} · 已处理 {session.processed} / {session.total} 张 · 未分析 {session.unanalysed} 张{failed?` · 失败 ${failed} 张`:""}</p>}
    {running&&<Button size="small" variant="ghost" disabled={busy||session?.cancelRequested} onClick={()=>void command("cancel")}>{session?.cancelRequested?"正在停止，保留完成结果…":`停止${session?.phase==="scanning"?"扫描":"分析"}`}</Button>}
    {(error||session?.error)&&<p role="alert">{error||session?.error}</p>}
    {mode==="description"&&<p className="protection-section-hint">{availability?.message??"正在检查本地找图环境…"}</p>}
  </div>;
  return <section className="image-workbench" aria-label={source==="folder"?"本地文件夹找图":"图库自然语言找图"}>
    <div className="image-workbench-controls">
      <h2>{source==="folder"?"从文件夹挑图":"在图库里按画面找图"}</h2>
      <p>{source==="folder"?"选择文件夹只预览，不会自动导入。分析后可复制原图，或仅导入选中的图片。":"按图片内容排序，覆盖范围内的每一页。首次会建立本地索引，以后复用未变化的图片。"}</p>
      {source==="folder"&&<label><input type="checkbox" checked={recursive} disabled={running||busy} onChange={e=>setRecursive(e.target.checked)}/>下次选择时包括子文件夹</label>}
      <Button busy={busy} disabled={running} onClick={()=>void command("choose")}>{source==="folder"?session?"更换文件夹":"选择图片文件夹":session?"重新载入当前范围":"载入当前图库范围"}</Button>
      {session&&<p className="image-workbench-source">{session.name} · {session.total} 张图片{source==="folder"?session.recursive?" · 含子文件夹":" · 仅此文件夹":""}</p>}
      {stale&&<p role="alert">整理范围已变化，请重新载入当前范围。</p>}
      {source==="folder"&&<SegmentedControl label="文件夹查找方式" value={mode} options={[{value:"rules",label:"按探索规则排查"},{value:"elements",label:"按元素筛选"},{value:"description",label:"按画面描述"}]}
        onChange={v=>{if(!running&&!busy)setMode(v as WorkbenchMode);}}/>}
      {mode==="rules"?<div><p>默认复用探索中已启用的元素规则与阈值，只找出命中图片。</p><Button size="small" variant="ghost" disabled={running} onClick={onOpenProtection}>在探索调整规则</Button></div>
        :<>
          {mode==="description"&&<form onSubmit={e=>{e.preventDefault();if(!composing.current&&!busy&&!running&&session&&!stale)void command("start");}}>
            <label className="organize-field">想找什么画面？<input aria-label="画面描述" maxLength={500} placeholder="例如：雨夜的城市里，撑伞的蓝发女孩" value={text} disabled={running||busy}
              onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onChange={e=>setText(e.target.value)}/></label>
            {analysisActions}
          </form>}
          <ElementConditions expanded={mode==="elements"}>
            <p>点击元素，在“不限 → 需要 → 排除”之间切换。多个需要条件须同时满足。</p>
            <div className="workbench-elements">{ELEMENTS.map(([label,tag])=><button key={tag} type="button" disabled={running||busy} aria-pressed={!!elements[tag]} data-condition={elements[tag]??"any"}
              onClick={()=>setElements(current=>{const next={...current};if(!next[tag])next[tag]="include";else if(next[tag]==="include")next[tag]="exclude";else delete next[tag];return next;})}>{label} · {elements[tag]==="include"?"需要":elements[tag]==="exclude"?"排除":"不限"}</button>)}</div>
            <details><summary>更多识别标签</summary><label className="organize-field">需要包含<input aria-label="需要包含标签" placeholder="英文标签，逗号分隔" value={customInclude} disabled={running||busy} onChange={e=>setCustomInclude(e.target.value)}/></label>
              <label className="organize-field">不要包含<input aria-label="不要包含标签" value={customExclude} disabled={running||busy} onChange={e=>setCustomExclude(e.target.value)}/></label><p>使用当前标签模型，以 40% 检出阈值筛选；未分析或失败的图片不算“没有”。</p></details>
          </ElementConditions>
          {(Object.keys(elements).length>0||customInclude||customExclude)&&<p>已附加元素条件：{Object.entries(elements).map(([tag,kind])=>`${kind==="include"?"需要":"排除"}${ELEMENTS.find(([,t])=>t===tag)?.[0]??tag}`).join("、")}{customInclude?` · 需要 ${customInclude}`:""}{customExclude?` · 排除 ${customExclude}`:""}</p>}
        </>}
      {mode!=="description"&&analysisActions}
      {mode==="description"&&<p className="protection-section-hint">相似度用于排序，不是识别正确率。明确的包含与排除请用元素条件。</p>}
      {session?.warnings.map((warning,i)=><p key={i} role="status">{warning}</p>)}
      {notice&&<p role="status">{notice}</p>}
    </div>
    <div className="image-workbench-results">
      <header><h2>{analyzed?`查找结果 · ${session?.matched??0} 张`:`图片预览 · ${session?.total??0} 张`}</h2>
        {session?.query&&<p>结果来自上次查找：{session.query.mode==="description"?session.query.text:session.query.mode==="rules"?"探索元素规则":"明确元素条件"}{session.query.include.length?` · 需要 ${session.query.include.join("、")}`:""}{session.query.exclude.length?` · 排除 ${session.query.exclude.join("、")}`:""}</p>}
        {session&&<SegmentedControl label="图片结果范围" value={filter} options={[{value:"matches",label:"匹配结果"},{value:"all",label:"全部图片"},{value:"failed",label:`失败 ${failed}`}]} onChange={v=>{if(!busy&&!running)void command("filter",v as Filter);}}/>}
      </header>
      {!session&&<p className="image-workbench-empty">{source==="folder"?"选择图片文件夹即可开始，不必先导入图库。":"先载入当前范围，再输入画面描述。"}</p>}
      {session&&!items.length&&<p className="image-workbench-empty">{running?"正在准备图片与模型，请稍候…":filter==="failed"?"没有分析失败的图片。":!analyzed?"这个范围没有找到支持的图片。":"当前没有匹配结果。未分析和失败的图片没有计入排除结果。"}</p>}
      {!!items.length&&<div className="workbench-result-toolbar"><Button size="small" disabled={busy||running} onClick={()=>setSelected(current=>{const next=new Map(current);for(const item of items)if(next.size<500)next.set(item.id,item.target);return next;})}>选择当前展示的图片</Button>
        <Button size="small" variant="ghost" disabled={running||!selected.size} onClick={()=>setSelected(new Map())}>取消选择</Button><span>已选 {selected.size} / 500 张 · 操作仅针对所选页</span></div>}
      <div className="workbench-image-grid">{items.map(item=><article key={item.id} className={selected.has(item.id)?"selected":""}>
        <label><input type="checkbox" aria-label={`选择 ${item.title}`} checked={selected.has(item.id)} disabled={running||busy||!selected.has(item.id)&&selected.size>=500} onChange={()=>toggle(item)}/><img src={item.previewUrl} alt={item.title} loading="lazy" decoding="async"/></label>
        <strong title={item.title}>{item.title}</strong><small>{item.status==="failed"?item.error:item.status==="pending"?"尚未分析":item.score!==undefined?`相似度 ${item.score.toFixed(3)}`:item.matched?"符合条件":"未匹配条件"}</small>
        <Button size="small" variant="ghost" disabled={running} onClick={()=>setSelectedPreview(current=>current?.id===item.id?null:item)}>取用此图</Button>
      </article>)}</div>
      {selectedPreview&&<section className="workbench-single-output" aria-label="取用所选单图"><strong>{selectedPreview.title}</strong><SingleImageActions target={selectedPreview.target}/><ExportImagesButton targets={[selectedPreview.target]} label="复制这页原图"/><Button size="small" variant="ghost" onClick={()=>setSelectedPreview(null)}>收起</Button></section>}
      {session?.hasMore&&<Button disabled={busy||running} onClick={()=>void command("more")}>再显示 60 张</Button>}
      {session&&<section className="workbench-result-actions" aria-label="取用筛选结果"><ExportImagesButton targets={[...selected.values()]} disabled={running||busy}/>
        {source==="folder"&&<Button variant="primary" disabled={running||busy||!selected.size} onClick={()=>void command("import")}>导入所选图片…</Button>}
        {source==="library"&&<><select aria-label="找图结果相册" value={album} disabled={running||busy} onChange={e=>setAlbum(e.target.value)}><option value="">选择相册…</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><Button disabled={running||busy||!album||!selected.size} onClick={()=>void assign()}>加入相册</Button></>}
        {onDiscuss&&<Button disabled={running||busy||!selected.size||selected.size>4} onClick={()=>void discuss()}>{source==="folder"?"导入后讨论所选图片…":"聊聊所选图片"}</Button>}
        <p>复制保留原图，同名自动另存；讨论最多选择 4 张图，文件夹图片先确认导入。</p></section>}
    </div>
  </section>;
}
function phaseLabel(s:WorkbenchSnapshot){return s.phase==="scanning"?`正在扫描（已查看 ${s.visited} 个目录项）`:s.phase==="analyzing"?s.processed?"正在分析":"正在准备模型与分析":s.phase==="completed"?"分析已结束":s.phase==="cancelled"?"已停止，保留完成结果":s.phase==="failed"?"任务失败，可重试":"可以开始分析";}
function message(e:unknown){return e instanceof Error?e.message:"操作失败，请重试";}
function ElementConditions({expanded,children}:{expanded:boolean;children:ReactNode}){return expanded?<section><h3>需要有 / 不要有</h3>{children}</section>:<SettingsDisclosure title="还要包含或排除元素" name="workbench-elements">{children}</SettingsDisclosure>;}
