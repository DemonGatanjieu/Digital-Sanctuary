import { useEffect, useRef, useState } from "react";
import type { WorkQuery } from "@sanctuary/domain";
import { GalleryPictureSearchController, pictureSearchRunning, type PictureSearchState } from "./gallery-picture-search";

export function useGalleryPictureSearch(query: WorkQuery, visible: boolean) {
  const [state,setState]=useState<PictureSearchState>({mode:"picture",draft:"",snapshot:null,pending:false,error:"",relevance:"relevant"});
  const controllerRef=useRef<GalleryPictureSearchController|null>(null);
  if(!controllerRef.current)controllerRef.current=new GalleryPictureSearchController({
    start:(text,filters)=>window.sanctuary.searchGalleryPictures(text,filters),
    startSimilar:(workId,assetId,filters)=>window.sanctuary.searchSimilarPictures(workId,assetId,filters),
    get:(id,offset,relevance)=>window.sanctuary.galleryPictureResults(id,offset,relevance),
    cancel:id=>window.sanctuary.cancelWorkbench(id)
  },setState);
  const controller=controllerRef.current;
  const running=pictureSearchRunning(state.snapshot);
  // Without the picture model the box searches names only, so typing never ends in a setup error.
  // Rechecked whenever the gallery comes back into view, so a model installed in Settings shows up at once.
  const [available,setAvailable]=useState(true);
  useEffect(()=>{
    if(!visible)return;
    let live=true;
    void window.sanctuary.semanticAvailability().then(status=>{
      if(!live)return;
      setAvailable(status.available);
      if(!status.available)controller.mode("name");
    }).catch(()=>{});
    return()=>{live=false;};
  },[controller,visible]);
  useEffect(()=>{
    if(!visible||!state.snapshot)return;
    void controller.refresh();
    if(!running)return;
    const timer=window.setInterval(()=>void controller.refresh(),750);
    return()=>window.clearInterval(timer);
  },[visible,state.snapshot?.progress.id,running,controller]);
  return { ...state, running, available, setDraft:(value:string)=>controller.draft(value),setMode:(mode:PictureSearchState["mode"])=>controller.mode(mode),
    search:()=>controller.search(query),similar:(target:{workId:string;assetId:string;title:string})=>controller.similar(target,query),cancel:()=>controller.cancel(),clear:()=>controller.clear(),loadMore:()=>controller.refresh(true),refresh:()=>controller.refresh(),
    setRelevance:(relevance:PictureSearchState["relevance"])=>controller.setRelevance(relevance) };
}
export type GalleryPictureSearch = ReturnType<typeof useGalleryPictureSearch>;
