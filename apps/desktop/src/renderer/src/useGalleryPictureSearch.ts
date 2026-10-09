import { useEffect, useRef, useState } from "react";
import type { WorkQuery } from "@sanctuary/domain";
import { GalleryPictureSearchController, pictureSearchRunning, type PictureSearchState } from "./gallery-picture-search";

export function useGalleryPictureSearch(query: WorkQuery, visible: boolean) {
  const [state,setState]=useState<PictureSearchState>({mode:"picture",draft:"",snapshot:null,pending:false,error:"",relevance:"relevant"});
  const controllerRef=useRef<GalleryPictureSearchController|null>(null);
  if(!controllerRef.current)controllerRef.current=new GalleryPictureSearchController({
    start:(text,filters)=>window.sanctuary.searchGalleryPictures(text,filters),
    get:(id,offset,relevance)=>window.sanctuary.galleryPictureResults(id,offset,relevance),
    cancel:id=>window.sanctuary.cancelWorkbench(id)
  },setState);
  const controller=controllerRef.current;
  const running=pictureSearchRunning(state.snapshot);
  // Installs without the offline picture model search by name only, so typing never ends in a setup error.
  const [available,setAvailable]=useState(true);
  useEffect(()=>{
    let live=true;
    void window.sanctuary.semanticAvailability().then(status=>{if(live&&!status.available){setAvailable(false);controller.mode("name");}}).catch(()=>{});
    return()=>{live=false;};
  },[controller]);
  useEffect(()=>{
    if(!visible||!state.snapshot)return;
    void controller.refresh();
    if(!running)return;
    const timer=window.setInterval(()=>void controller.refresh(),750);
    return()=>window.clearInterval(timer);
  },[visible,state.snapshot?.progress.id,running,controller]);
  return { ...state, running, available, setDraft:(value:string)=>controller.draft(value),setMode:(mode:PictureSearchState["mode"])=>controller.mode(mode),
    search:()=>controller.search(query),cancel:()=>controller.cancel(),clear:()=>controller.clear(),loadMore:()=>controller.refresh(true),refresh:()=>controller.refresh(),
    setRelevance:(relevance:PictureSearchState["relevance"])=>controller.setRelevance(relevance) };
}
export type GalleryPictureSearch = ReturnType<typeof useGalleryPictureSearch>;
