import { describe, expect, it, vi, afterEach } from "vitest";
import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import type { InspirationConversation, WorkRecord } from "@sanctuary/domain";
import type { LocalArtCriticService } from "./vision/local-art-critic-service.js";
const prep = vi.hoisted(() => ({ prepare: vi.fn(), stat: vi.fn(), dimensions: vi.fn() }));
vi.mock("node:fs/promises", async importOriginal => ({...await importOriginal<object>(), stat: prep.stat}));
vi.mock("./image-header-size.js", () => ({readImageHeaderSize:prep.dimensions}));
vi.mock("./vision/vision-image-preprocessor.js", () => ({ prepareVisionImage: prep.prepare }));
import { registerInspirationIpc } from "./inspiration-ipc.js";
afterEach(()=>vi.resetAllMocks());
function fixture() {
  let stored:InspirationConversation[]=[];
  const handlers=new Map<string,(...args:any[])=>any>();
  const works=[0,1].map(index=>({id:`local:${index}`,title:`图${index}`,artistName:null,assets:[{id:`asset:${index}`,pageIndex:index,path:`image-${index}.png`,mediaType:"image",fileState:"available"}]} as WorkRecord));
  const chat=vi.fn(async(_input:unknown)=>({identity:{modelId:"test",modelVersion:"1",evaluatorVersion:"1"},content:"图片1和图片2有不同的配色。"}));
  registerInspirationIpc({handle:(channel:string,handler:any)=>handlers.set(channel,handler)} as unknown as IpcMain,
    {getPreference:()=>structuredClone(stored),setPreference:(_key:string,value:InspirationConversation[])=>{stored=structuredClone(value);},getWork:(id:string)=>works.find(work=>work.id===id)??null} as unknown as LibraryDatabase,
    {chat} as unknown as LocalArtCriticService,undefined,{copyText:()=>{},saveMarkdown:async()=>({canceled:true})});
  const cleanup=vi.fn();prep.prepare.mockImplementation(async(path:string)=>({buffer:Buffer.from(path),mimeType:"image/png",byteLength:10,cleanup}));
  prep.stat.mockResolvedValue({size:10});prep.dimensions.mockResolvedValue({width:1,height:1});
  const send=(sources:unknown)=>handlers.get("inspiration:send")!({}, {requestId:crypto.randomUUID(),presetId:"image_chat",message:"比较这些图",sources});
  return {send,chat,cleanup,handlers,stored:()=>stored};
}
describe("image-grounded multi-picture conversation",()=>{
  it("rejects oversized files and pixel counts before decoding images",async()=>{
    const f=fixture(),sources=[{workId:"local:0",pageIndex:0}];
    prep.stat.mockResolvedValueOnce({size:33*1024*1024});await expect(f.send(sources)).rejects.toThrow("32 MB");
    prep.dimensions.mockResolvedValueOnce({width:10000,height:10000});await expect(f.send(sources)).rejects.toThrow("尺寸过大");
    expect(prep.prepare).not.toHaveBeenCalled();expect(f.chat).not.toHaveBeenCalled();
  });
  it("passes actual images in selection order and persists the per-reply references",async()=>{
    const f=fixture(),sources=[{workId:"local:1",pageIndex:1},{workId:"local:0",pageIndex:0}];
    const conversation=await f.send(sources) as InspirationConversation;
    const input=f.chat.mock.calls[0]![0] as any;
    expect(input.images.map((image:any)=>image.buffer.toString())).toEqual(["image-1.png","image-0.png"]);
    expect(input.systemPrompt).toContain("图片 1：《图1》");expect(conversation.sources?.map(source=>source.workId)).toEqual(["local:1","local:0"]);
    const provenance=conversation.messages.at(-1)!.provenance!;expect(provenance.sources).toMatchObject(sources);expect(f.cleanup).toHaveBeenCalledTimes(2);
    await f.handlers.get("inspiration:update-source")!({}, {conversationId:conversation.id,sourceWorkId:null,sources:[]});
    expect(f.stored()[0]!.source).toBeNull();expect(f.stored()[0]!.messages.at(-1)!.provenance).toEqual(provenance);
  });
  it("rejects excess, duplicate and missing pages before running a model",async()=>{
    const f=fixture();
    await expect(f.send(Array(5).fill({workId:"local:0",pageIndex:0}))).rejects.toThrow("4 张");
    await expect(f.send(Array(2).fill({workId:"local:0",pageIndex:0}))).rejects.toThrow("重复");
    await expect(f.send([{workId:"local:0",pageIndex:100}])).rejects.toThrow("不可用");
    expect(f.chat).not.toHaveBeenCalled();expect(f.stored()).toEqual([]);
  });
  it("cleans every prepared image if another reference fails, without saving a fabricated reply",async()=>{
    const f=fixture();prep.prepare.mockImplementationOnce(async()=>({buffer:Buffer.from("image"),mimeType:"image/png",byteLength:5,cleanup:f.cleanup})).mockRejectedValueOnce(new Error("图片不可读取"));
    await expect(f.send([{workId:"local:0",pageIndex:0},{workId:"local:1",pageIndex:1}])).rejects.toThrow("不可读取");
    expect(f.cleanup).toHaveBeenCalledOnce();expect(f.chat).not.toHaveBeenCalled();expect(f.stored()[0]!.messages.map(message=>message.role)).toEqual(["user"]);
  });
});
