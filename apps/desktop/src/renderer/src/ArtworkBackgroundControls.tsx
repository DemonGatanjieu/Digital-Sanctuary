import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { DialogOverlay } from "./DialogOverlay";
import { LibraryImagePicker, type LibraryImageChoice } from "./LibraryImagePicker";

export function useArtworkBackground(surface:"gallery"|"home"){
  const [image,setImage]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const alive=useRef(false),generation=useRef(0),pending=useRef(false);
  const api=()=>surface==="gallery"?{get:window.sanctuary.getGalleryBanner,choose:window.sanctuary.chooseGalleryBanner,library:window.sanctuary.setGalleryBannerFromLibrary,reset:window.sanctuary.resetGalleryBanner}
    :{get:window.sanctuary.getHomeBackground,choose:window.sanctuary.chooseHomeBackground,library:window.sanctuary.setHomeBackgroundFromLibrary,reset:window.sanctuary.resetHomeBackground};
  useEffect(()=>{alive.current=true;const request=++generation.current;void api().get().then(value=>{if(alive.current&&request===generation.current)setImage(value);}).catch(()=>{if(alive.current&&request===generation.current)setError("读取图片设置失败，请重新选择");});return()=>{alive.current=false;};},[surface]);
  async function update(action:"choose"|"reset"|LibraryImageChoice){
    if(pending.current)throw new Error("请先完成当前图片选择");pending.current=true;++generation.current;setBusy(true);setError("");
    try{const host=api(),value=action==="choose"?await host.choose():action==="reset"?await host.reset():await host.library(action);if(alive.current)setImage(value);}
    catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"设置图片失败，请重试");throw cause;}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  return {image,busy,error,update};
}
export function ArtworkBackgroundControls({surface,background}:{surface:"gallery"|"home";background:ReturnType<typeof useArtworkBackground>}){
  const [chooser,setChooser]=useState(false),[picker,setPicker]=useState(false);
  const label=surface==="gallery"?"横幅":"背景";
  return <>
    <div className="gallery-banner-actions"><Button size="small" variant="ghost" disabled={background.busy} onClick={()=>setChooser(true)}>更换{label}</Button>
      {background.image&&<Button size="small" variant="ghost" disabled={background.busy} onClick={()=>void background.update("reset").catch(()=>{})}>{surface==="gallery"?"恢复自动精选":"恢复默认背景"}</Button>}</div>
    {background.error&&<p className="gallery-banner-error" role="alert">{background.error}</p>}
    {chooser&&<DialogOverlay busy={background.busy} onClose={()=>setChooser(false)}><section className="dialog-surface background-source-dialog" role="dialog" aria-modal="true" aria-label={`更换${label}`}>
      <h2>用哪张图片作{label}？</h2><p>选择后保存独立缩图，原图移动或删除也不影响显示。</p>
      <Button variant="primary" disabled={background.busy} onClick={()=>{setChooser(false);setPicker(true);}}>从图库选择</Button>
      <Button busy={background.busy} busyLabel="正在选择…" onClick={()=>void background.update("choose").then(()=>setChooser(false)).catch(()=>{})}>选择本地图片</Button>
      {background.error&&<p role="alert">{background.error}</p>}<Button variant="ghost" disabled={background.busy} onClick={()=>setChooser(false)}>取消</Button>
    </section></DialogOverlay>}
    {picker&&<LibraryImagePicker onClose={()=>setPicker(false)} onSelect={target=>background.update(target)}/>}
  </>;
}
