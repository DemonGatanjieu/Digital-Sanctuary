import { useEffect, useRef, useState } from "react";
import type { ImageTarget, WorkDeletionPreview } from "@sanctuary/domain";
import { Button } from "./Button";
import { DialogOverlay } from "./DialogOverlay";
import { SettingsDisclosure } from "./SettingsDisclosure";

export function WorkbenchRemoval({targets,disabled,onRemoved}:{targets:ImageTarget[];disabled:boolean;onRemoved:(message:string)=>Promise<void>}){
  const [preview,setPreview]=useState<WorkDeletionPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const pending=useRef(false),alive=useRef(false),ids=[...new Set(targets.flatMap(target=>"workId" in target?[target.workId]:[]))];
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function command(action:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setError("");try{await action();}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"处理失败，请重试");}finally{pending.current=false;if(alive.current)setBusy(false);}}
  return <SettingsDisclosure title="移出所选作品" description="按整件作品处理，确认前先看预览。" name="workbench-removal">
    <p>即使只勾选一页，也会处理它所属的整件作品及全部页。</p>
    <Button variant="danger-soft" disabled={disabled||!ids.length} busy={busy} onClick={()=>void command(async()=>{setPreview(await window.sanctuary.previewWorkDeletion(ids));})}>预览移出 {ids.length} 件作品</Button>
    {error&&<p role="alert">{error}</p>}
    {preview&&<DialogOverlay busy={busy} onClose={()=>setPreview(null)}><section className="dialog-surface work-delete-dialog" role="dialog" aria-modal="true" aria-label="确认移出作品">
      <h2>移出 {preview.items.length} 件作品？</h2>
      <p>{preview.managedWorkCount} 件图库保存作品的文件将移至 Windows 回收站；{preview.externalWorkCount} 件外部引用只移除索引，保留原文件。</p>
      <p>共涉及 {preview.fileCount} 个文件，按整件作品处理。</p>
      {error&&<p role="alert">{error}</p>}
      <footer><Button disabled={busy} onClick={()=>setPreview(null)}>取消</Button><Button variant="danger" busy={busy} onClick={()=>void command(async()=>{
        const result=await window.sanctuary.confirmWorkDeletion(preview.token);setPreview(null);
        await onRemoved(`已处理 ${result.completedWorkIds.length} 件作品。${result.failures.length?`另有 ${result.failures.length} 件失败，请重新选择后重试。`:""}`);
      })}>确认移出</Button></footer>
    </section></DialogOverlay>}
  </SettingsDisclosure>;
}
