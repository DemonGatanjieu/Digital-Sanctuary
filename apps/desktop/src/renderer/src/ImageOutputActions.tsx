import { useEffect, useRef, useState } from "react";
import type { ImageExportBatch, ImageTarget } from "@sanctuary/domain";
import { Button } from "./Button";

export function ExportImagesButton({ targets, label="复制所选原图", disabled=false }: { targets: ImageTarget[]; label?: string; disabled?: boolean }) {
  const [batch,setBatch]=useState<ImageExportBatch|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const alive=useRef(true),pending=useRef(false);
  useEffect(()=>{alive.current=true;void window.sanctuary.currentImageExport().then(b=>{if(alive.current)setBatch(b);}).catch(()=>undefined);return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(batch?.phase!=="running")return;
    let active=true,timer:number;
    const poll=async()=>{try{const b=await window.sanctuary.getImageExport(batch.id);if(!active)return;setBatch(b);if(b.phase==="running")timer=window.setTimeout(()=>void poll(),500);}
      catch(e){if(active)setError(message(e));}};
    timer=window.setTimeout(()=>void poll(),150);return()=>{active=false;clearTimeout(timer);};
  },[batch?.id,batch?.phase]);
  async function command(action:"start"|"cancel"|"retry") {
    if(pending.current)return;pending.current=true;setBusy(true);setError("");
    try{const b=action==="start"?await window.sanctuary.exportImages(targets):action==="cancel"?await window.sanctuary.cancelImageExport(batch!.id):await window.sanctuary.retryImageExport(batch!.id);
      if(alive.current&&b)setBatch(b);
    }catch(e){if(alive.current)setError(message(e));}finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  const failed=batch?.items.filter(i=>i.status==="failed")??[],remaining=batch?.items.filter(i=>i.status==="cancelled").length??0;
  return <div className="image-output-actions">
    <Button size="small" busy={busy} disabled={disabled||!targets.length||batch?.phase==="running"} onClick={()=>void command("start")}>{label}</Button>
    {batch&&<div className="image-output-progress"><p role="status">{batch.phase==="running"?"正在复制原图":batch.phase==="cancelled"?"已停止复制":"复制已结束"}：{batch.items.filter(i=>i.status==="copied").length} / {batch.items.length} 张{failed.length?`，${failed.length} 张失败`:""}{remaining?`，${remaining} 张未处理`:""}</p>
      {batch.phase==="running"?<Button size="small" variant="ghost" disabled={busy||batch.cancelRequested} onClick={()=>void command("cancel")}>{batch.cancelRequested?"正在停止…":"停止复制"}</Button>
        :(failed.length>0||remaining>0)&&<Button size="small" disabled={busy} onClick={()=>void command("retry")}>重试未完成项</Button>}
      {failed.length>0&&<details><summary>查看复制失败原因</summary>{failed.slice(0,30).map(i=><p key={i.id}>{i.fileName}：{i.error}</p>)}{failed.length>30&&<p>另有 {failed.length-30} 张失败，可一并重试。</p>}</details>}
    </div>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
export function SingleImageActions({target,disabled=false}:{target:ImageTarget;disabled?:boolean}) {
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function use(action:"copy"|"reveal") {
    if(busy)return;setBusy(true);setNotice("");try{await window.sanctuary.useImage(target,action);if(alive.current)setNotice(action==="copy"?"图片已复制，可以粘贴使用":"已在文件夹中定位原图");}
    catch(e){if(alive.current)setNotice(message(e));}finally{if(alive.current)setBusy(false);}
  }
  return <div className="image-output-actions"><Button size="small" disabled={disabled||busy} onClick={()=>void use("copy")}>复制图片</Button><Button size="small" disabled={disabled||busy} onClick={()=>void use("reveal")}>打开所在位置</Button>{notice&&<p role="status">{notice}</p>}</div>;
}
function message(e:unknown){return e instanceof Error?e.message:"图片操作失败，请重试";}
