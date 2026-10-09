import { parseWorkQuery } from "../shared/library-query.js";
import type { BrowserWindow, IpcMain } from "electron";
import type { WorkQuery } from "@sanctuary/domain";
import type { ImageWorkbenchService } from "./image-workbench-service.js";
import { ImageOutputService, type ImageOutputHost } from "./image-output-service.js";
import type { SemanticClient } from "./semantic-client.js";
import { stat } from "node:fs/promises";
import { readImageHeaderSize } from "./image-header-size.js";

export function createImageOutputHost(getWindow: () => BrowserWindow | null): ImageOutputHost {
  return {
    async chooseDirectory() {
      const {dialog}=await import("electron"),window=getWindow();
      const options={title:"复制原图到文件夹",properties:["openDirectory","createDirectory"] as Array<"openDirectory"|"createDirectory">};
      const selected=window?await dialog.showOpenDialog(window,options):await dialog.showOpenDialog(options);
      return selected.canceled?null:selected.filePaths[0]??null;
    },
    async copyImage(path) {
      if((await stat(path)).size>32*1024*1024)throw new Error("这张图片超过 32 MB，请使用复制原图到文件夹");
      const size=await readImageHeaderSize(path);
      if(!size)throw new Error("这个格式暂不能直接粘贴，请使用复制原图到文件夹");
      if(size.width*size.height>32_000_000)throw new Error("这张图片过大，请使用复制原图到文件夹");
      const {nativeImage,clipboard}=await import("electron");
      const image=await nativeImage.createThumbnailFromPath(path,{width:Math.min(size.width,4096),height:Math.min(size.height,4096)});
      if(image.isEmpty())throw new Error("无法复制这张图片，请改用复制原图到文件夹");
      if(image.getSize().width*image.getSize().height>32_000_000)throw new Error("这张图片过大，请使用复制原图到文件夹");
      clipboard.writeImage(image);
    },
    async reveal(path) { const {shell}=await import("electron");shell.showItemInFolder(path); }
  };
}
export function registerImageWorkbenchIpc(ipc: Pick<IpcMain,"handle">, workbench: ImageWorkbenchService,
  output: ImageOutputService, semantic: SemanticClient,
  resolveQuery: (query: WorkQuery) => WorkQuery = (query) => query) {
  ipc.handle("images:export",(e,value: unknown)=>output.start(e.sender.id,value));
  ipc.handle("images:export-get",(e,id: unknown)=>output.get(e.sender.id,id));
  ipc.handle("images:export-current",e=>output.current(e.sender.id));
  ipc.handle("images:export-cancel",(e,id: unknown)=>output.cancel(e.sender.id,id));
  ipc.handle("images:export-retry",(e,id: unknown)=>output.retry(e.sender.id,id));
  ipc.handle("images:use",(e,target: unknown,action: unknown)=>output.use(e.sender.id,target,action));
  ipc.handle("gallery:search-pictures",(e,text: unknown,query: unknown)=>{
    if(e.senderFrame!==e.sender.mainFrame)throw new Error("请在图库中搜索");
    return workbench.searchGallery(e.sender.id,text,resolveQuery(parseWorkQuery(query)));
  });
  ipc.handle("gallery:search-similar",(e,workId: unknown,assetId: unknown,query: unknown)=>{
    if(e.senderFrame!==e.sender.mainFrame)throw new Error("请在图库中搜索");
    return workbench.searchSimilar(e.sender.id,workId,assetId,resolveQuery(parseWorkQuery(query)));
  });
  ipc.handle("gallery:picture-results",(e,id: unknown,offset: unknown,relevance: unknown)=>{
    if(e.senderFrame!==e.sender.mainFrame)throw new Error("请在图库中搜索");
    return workbench.galleryResults(e.sender.id,id,offset,relevance);
  });
  ipc.handle("gallery:current-picture-search",e=>{
    if(e.senderFrame!==e.sender.mainFrame)throw new Error("请在图库中搜索");
    return workbench.currentGallery(e.sender.id);
  });
  ipc.handle("workbench:cancel",(e,id: unknown)=>workbench.cancel(e.sender.id,id));
  ipc.handle("workbench:semantic-status",()=>semantic.availability());
  ipc.handle("tasks:images",e=>[...workbench.tasks(e.sender.id),...output.tasks(e.sender.id)]);
}
