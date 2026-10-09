import { useEffect, useRef, useState } from "react";
import type { AnalysisJob, AnalysisScope, AnalysisScopePreview } from "@sanctuary/domain";
import type { AppStatus } from "./AppSidebar";
import { Button } from "./Button";

export function AlbumSuggestions({scope,status,onApplied,onOpenProtection,initialJobId,onJobOpened}:{scope:AnalysisScope;status:AppStatus|null;onApplied:()=>Promise<void>;onOpenProtection:()=>void;initialJobId?:string|null|undefined;onJobOpened?:(()=>void)|undefined}){
  const [preview,setPreview]=useState<AnalysisScopePreview|null>(null),[jobs,setJobs]=useState<AnalysisJob[]>([]),[chosen,setChosen]=useState<Record<string,string[]>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const alive=useRef(false),pending=useRef(false),scopeKey=JSON.stringify(scope),scopeRef=useRef(scopeKey);scopeRef.current=scopeKey;
  async function refresh(){const next=await window.sanctuary.listAnalysisJobs();if(alive.current)setJobs(next);}
  useEffect(()=>{alive.current=true;void refresh().catch(cause=>{if(alive.current)setError(message(cause));});return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(!jobs.some(job=>job.status==="queued"||job.status==="running"))return;const timer=setInterval(()=>void refresh().catch(cause=>{if(alive.current)setError(message(cause));}),1200);return()=>clearInterval(timer);},[jobs]);
  useEffect(()=>{setPreview(null);},[scopeKey]);
  useEffect(()=>{if(!initialJobId||!jobs.some(job=>job.id===initialJobId))return;const frame=requestAnimationFrame(()=>{document.getElementById(`analysis-job-${initialJobId}`)?.scrollIntoView({block:"nearest"});onJobOpened?.();});return()=>cancelAnimationFrame(frame);},[initialJobId,jobs,onJobOpened]);
  async function command(action:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setError("");try{await action();}catch(cause){if(alive.current)setError(message(cause));}finally{pending.current=false;if(alive.current)setBusy(false);}}
  async function inspect(){const key=scopeKey,next=await window.sanctuary.previewAnalysis(scope);if(alive.current&&scopeRef.current===key)setPreview(next);}
  async function start(){
    if(!preview||JSON.stringify(preview.scope)!==scopeKey)return;
    const job=await window.sanctuary.createAnalysisJob(preview.scope);await window.sanctuary.startAnalysisJob(job.id);
    if(alive.current){setPreview(null);setNotice("分析已开始，完成后由你确认相册建议。");}await refresh();
  }
  async function apply(job:AnalysisJob){
    const ids=chosen[job.id]??[];if(!ids.length)return;
    const result=await window.sanctuary.applyAnalysisSuggestions(job.id,ids);
    if(alive.current){setChosen(current=>({...current,[job.id]:[]}));setNotice(`已整理 ${result.affectedWorkCount} 个作品。`);}await onApplied();await refresh();
  }
  return <section className="album-suggestions" aria-label="相册建议与任务记录">
    <header><h2>相册建议与任务记录</h2><p>先确认范围，再分析；选择建议后才会建立相册。</p></header>
    <div className="album-suggestions-actions"><Button busy={busy} onClick={()=>void command(inspect)}>预览分析范围</Button>
      {preview&&JSON.stringify(preview.scope)===scopeKey&&<><span>{preview.workCount} 个作品 · {preview.assetCount} 张图片 · 已有分析 {preview.cachedAssetCount} 张</span>
        <Button variant="primary" disabled={busy||!preview.assetCount||!status?.visionReady||!status.modelBacked} onClick={()=>void command(start)}>开始图片分析</Button>
        {(!status?.visionReady||!status.modelBacked)&&<Button onClick={onOpenProtection}>检查识别模型</Button>}</>}
    </div>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!jobs.length&&<p>还没有分析任务，可以先预览当前范围。</p>}
    <div className="album-suggestions-jobs">{jobs.map(job=>{
      const selected=chosen[job.id]??[],percent=job.totalItems?Math.round(job.processedItems/job.totalItems*100):0;
      return <article key={job.id} id={`analysis-job-${job.id}`} className="studio-job-card">
        <header><strong>{statusLabel(job.status)} · {job.processedItems} / {job.totalItems} 张</strong><small>{new Date(job.createdAt).toLocaleString("zh-CN")}{job.failedItems?` · ${job.failedItems} 张失败`:""}</small>
          {(job.status==="queued"||job.status==="running")&&<Button size="small" disabled={busy} onClick={()=>void command(async()=>{await window.sanctuary.cancelAnalysisJob(job.id);await refresh();})}>停止任务</Button>}</header>
        <progress max={100} value={percent} aria-label="相册分析进度"/>{job.error&&<p role="alert">{job.error}</p>}
        {job.status==="completed"&&<>{!job.suggestions.length?<p>这次没有足够明确的相册建议。</p>:<>
          <div className="studio-suggestions-grid">{job.suggestions.map(suggestion=><label className="studio-suggestion-card" key={suggestion.id}>
            <input type="checkbox" checked={selected.includes(suggestion.id)} disabled={busy} onChange={event=>setChosen(current=>({...current,[job.id]:event.target.checked?[...selected,suggestion.id]:selected.filter(id=>id!==suggestion.id)}))}/>
            <span>{suggestion.label.replaceAll("_"," ")} · {suggestion.workIds.length} 个作品</span></label>)}</div>
          <Button variant="primary" disabled={busy||!selected.length} onClick={()=>void command(()=>apply(job))}>确认所选建议并建立相册 ({selected.length})</Button>
        </>}</>}
      </article>;
    })}</div>
  </section>;
}
function statusLabel(status:AnalysisJob["status"]){return {queued:"等待开始",running:"分析中",completed:"已完成",cancelled:"已停止",failed:"任务失败"}[status];}
function message(cause:unknown){return cause instanceof Error?cause.message:"操作失败，请重试";}
