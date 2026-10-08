import { useEffect, useRef, useState } from "react";
import type { WorkQuery } from "@sanctuary/domain";
import { GalleryPictureSearchController, pictureSearchRunning, type PictureSearchState } from "./gallery-picture-search";

export function useGalleryPictureSearch(query: WorkQuery, visible: boolean) {
  const [state,setState]=useState<PictureSearchState>({mode:"picture",draft:"",snapshot:null,pending:false,error:""});
  const controllerRef=useRef<GalleryPictureSearchController|null>(null);
  if(!controllerRef.current)controllerRef.current=new GalleryPictureSearchController({
    start:(text,filters)=>window.sanctuary.searchGalleryPictures(text,filters),
    get:(id,offset)=>window.sanctuary.galleryPictureResults(id,offset),
    cancel:id=>window.sanctuary.cancelWorkbench(id)
  },setState);
  const controller=controllerRef.current;
  const running=pictureSearchRunning(state.snapshot);
  useEffect(()=>{
    if(!visible||!state.snapshot)return;
    void controller.refresh();
    if(!running)return;
    const timer=window.setInterval(()=>void controller.refresh(),750);
    return()=>window.clearInterval(timer);
  },[visible,state.snapshot?.progress.id,running,controller]);
  return { ...state, running, setDraft:(value:string)=>controller.draft(value),setMode:(mode:PictureSearchState["mode"])=>controller.mode(mode),
    search:()=>controller.search(query),cancel:()=>controller.cancel(),clear:()=>controller.clear(),loadMore:()=>controller.refresh(true),refresh:()=>controller.refresh() };
}
export type GalleryPictureSearch = ReturnType<typeof useGalleryPictureSearch>;
