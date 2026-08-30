import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import type { InspirationConversation, WorkRecord } from "@sanctuary/domain";
import { describe, expect, it } from "vitest";
import { presetSystemPrompt, registerInspirationIpc } from "./inspiration-ipc.js";

describe("local inspiration prompt presets", () => {
  it("keeps image-grounded conversation honest when no image is attached", () => {
    const prompt = presetSystemPrompt("image_chat", false);
    expect(prompt).toContain("不要假装自己看到了图片");
    expect(prompt).toContain("叙事线索");
  });

  it("keeps prompt notes separate from classifier confidence", () => {
    expect(presetSystemPrompt("prompt_notes", true)).toContain("不要把识别置信度当生成权重");
  });

  it("re-resolves a selected gallery page in the main process", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const conversation: InspirationConversation = {
      id: "conversation-1",
      title: "测试",
      presetId: "image_chat",
      source: null,
      modelId: null,
      messages: [],
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z"
    };
    let stored: unknown = [conversation];
    const work = {
      id: "work-1",
      title: "多页作品",
      artistName: "画师",
      assets: [
        { id: "asset-0", pageIndex: 0, path: "E:\\gallery\\p0.png", mediaType: "image", fileState: "available" },
        { id: "asset-2", pageIndex: 2, path: "E:\\gallery\\p2.png", mediaType: "image", fileState: "available" }
      ]
    } as WorkRecord;
    const database = {
      getPreference: () => stored,
      setPreference: (_key: string, value: unknown) => { stored = value; },
      getWork: (id: string) => id === work.id ? work : null
    } as unknown as LibraryDatabase;
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler); }
    } as unknown as IpcMain;
    registerInspirationIpc(ipc, database, undefined);

    const updated = await handlers.get("inspiration:update-source")?.({}, {
      conversationId: conversation.id,
      sourceWorkId: work.id,
      sourcePageIndex: 2
    }) as InspirationConversation;
    expect(updated.source).toMatchObject({ workId: "work-1", pageIndex: 2, title: "多页作品" });
    expect(updated.source?.imageUrl).toContain("p2.png");
  });
});
