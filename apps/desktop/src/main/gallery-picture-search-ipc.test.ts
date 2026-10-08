import { describe,it,expect,vi } from "vitest";
import type { IpcMain } from "electron";
import type { ImageWorkbenchService } from "./image-workbench-service";
import type { ImageOutputService } from "./image-output-service";
import type { SemanticClient } from "./semantic-client";
import { registerImageWorkbenchIpc } from "./image-workbench-ipc";
function fixture(){const handlers=new Map<string,(...args:any[])=>unknown>(),workbench={searchGallery:vi.fn(),galleryResults:vi.fn(),currentGallery:vi.fn()};
  registerImageWorkbenchIpc({handle:(name:string,handler:any)=>handlers.set(name,handler)} as unknown as IpcMain,workbench as unknown as ImageWorkbenchService,{} as ImageOutputService,{} as SemanticClient,async()=>null);
  const frame={};return {handlers,workbench,event:{sender:{id:42,mainFrame:frame},senderFrame:frame}};
}
describe("gallery picture search IPC boundary",()=>{
  it("requires the local main frame for starts, polling and restoration",()=>{
    const f=fixture();for(const name of ["gallery:search-pictures","gallery:picture-results","gallery:current-picture-search"])
      expect(()=>f.handlers.get(name)!({...f.event,senderFrame:{}},"description",{})).toThrow("图库");
    expect(f.workbench.searchGallery).not.toHaveBeenCalled();expect(f.workbench.galleryResults).not.toHaveBeenCalled();
  });
  it("sanitizes filters and binds requests to the actual sender rather than a renderer-provided owner",()=>{
    const f=fixture();f.handlers.get("gallery:search-pictures")!(f.event,"海边女孩",{ownership:"external",favorite:true,limit:90000,offset:-1,owner:999,path:"private.png"});
    expect(f.workbench.searchGallery).toHaveBeenCalledWith(42,"海边女孩",{ownership:"external",favorite:true,limit:200,offset:0});
    f.handlers.get("gallery:picture-results")!(f.event,"job",60);expect(f.workbench.galleryResults).toHaveBeenCalledWith(42,"job",60);
  });
});
