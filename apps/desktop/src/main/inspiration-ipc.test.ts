import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import type { InspirationConversation, WorkRecord } from "@sanctuary/domain";
import { describe, expect, it, vi } from "vitest";
import type { LocalArtCriticService } from "./vision/local-art-critic-service.js";
import type { InspirationOutputHost } from "./inspiration-export.js";
import { inspirationGenerationProfile, presetSystemPrompt, registerInspirationIpc } from "./inspiration-ipc.js";

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
      settings: { creativity: "balanced", responseLength: "standard" },
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

  it("maps friendly controls to bounded generation parameters", () => {
    expect(inspirationGenerationProfile({ creativity: "precise", responseLength: "brief" })).toMatchObject({
      temperature: 0.35,
      maxTokens: 600
    });
    expect(inspirationGenerationProfile({ creativity: "imaginative", responseLength: "detailed" })).toMatchObject({
      temperature: 1,
      maxTokens: 2200
    });
  });
});

function stableConversation(id = "conversation-1"): InspirationConversation {
  return { id, title: `创作 ${id}`, presetId: "chat", source: null, modelId: "old-model",
    settings: { creativity: "balanced", responseLength: "standard" },
    messages: [
      { id: `${id}-user`, role: "user", content: "旧提问", createdAt: "2026-10-03T00:00:00.000Z" },
      { id: `${id}-reply`, role: "assistant", content: "稳定旧回答", createdAt: "2026-10-03T00:00:01.000Z" }
    ], createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:01.000Z" };
}

function inspirationFixture(conversations = [stableConversation()]) {
  let stored: unknown = structuredClone(conversations);
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const pending: Array<{ resolve: (result: unknown) => void; reject: (error: unknown) => void; signal: AbortSignal }> = [];
  const database = { getPreference: () => structuredClone(stored), setPreference: (_key: string, value: unknown) => { stored = structuredClone(value); }, getWork: () => null } as unknown as LibraryDatabase;
  const chat = vi.fn((_input: unknown, signal: AbortSignal) => new Promise((resolve, reject) => pending.push({ resolve, reject, signal })));
  const output: InspirationOutputHost = { copyText: vi.fn(), saveMarkdown: vi.fn(async (fileName) => ({ canceled: false, fileName })) };
  registerInspirationIpc({ handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) } as unknown as IpcMain,
    database, { chat } as unknown as LocalArtCriticService, undefined, output);
  const invoke = async (channel: string, raw: unknown) => handlers.get(channel)!({}, raw);
  const finish = (index: number, content: string) => pending[index]!.resolve({ content, identity: { modelId: "actual-model", modelVersion: "v1", evaluatorVersion: "test-runtime" } });
  return { invoke, pending, chat, output, finish, stored: () => stored as InspirationConversation[] };
}

describe("inspiration stable persistence and export", () => {
  it("preserves the old answer when regeneration fails or is canceled", async () => {
    const fixture = inspirationFixture();
    const failed = fixture.invoke("inspiration:regenerate", { conversationId: "conversation-1", requestId: "regenerate-fail" });
    const rejected = expect(failed).rejects.toThrow("model failure");
    fixture.pending[0]!.reject(new Error("model failure")); await rejected;
    expect(fixture.stored()[0]?.messages.at(-1)?.content).toBe("稳定旧回答");
    const canceled = fixture.invoke("inspiration:regenerate", { conversationId: "conversation-1", requestId: "regenerate-cancel" });
    const stopped = expect(canceled).rejects.toThrow("已停止");
    expect(await fixture.invoke("inspiration:cancel", "regenerate-cancel")).toBe(true);
    fixture.finish(1, "不应保存的回答"); await stopped;
    expect(fixture.stored()[0]?.messages.at(-1)?.content).toBe("稳定旧回答");
  });

  it("merges reverse completed conversations without resurrecting another deletion", async () => {
    const fixture = inspirationFixture([stableConversation("first"), stableConversation("second"), stableConversation("deleted")]);
    const first = fixture.invoke("inspiration:send", { conversationId: "first", requestId: "send-first", presetId: "chat", message: "第一问" });
    const second = fixture.invoke("inspiration:send", { conversationId: "second", requestId: "send-second", presetId: "chat", message: "第二问" });
    await fixture.invoke("inspiration:delete", "deleted");
    fixture.finish(1, "第二回答"); await second;
    fixture.finish(0, "第一回答"); await first;
    expect(fixture.stored().map((conversation) => conversation.id).sort()).toEqual(["first", "second"]);
    expect(fixture.stored().find((conversation) => conversation.id === "first")?.messages.at(-1)?.content).toBe("第一回答");
    expect(fixture.stored().find((conversation) => conversation.id === "second")?.messages.at(-1)?.content).toBe("第二回答");
  });

  it("aborts deleted active conversations and does not recreate missing IDs", async () => {
    const fixture = inspirationFixture();
    const pending = fixture.invoke("inspiration:send", { conversationId: "conversation-1", requestId: "deleted-active", presetId: "chat", message: "未完成问题" });
    const stopped = expect(pending).rejects.toThrow("已停止");
    await fixture.invoke("inspiration:delete", "conversation-1");
    expect(fixture.pending[0]!.signal.aborted).toBe(true);
    fixture.finish(0, "迟到回答"); await stopped;
    expect(fixture.stored()).toEqual([]);
    await expect(fixture.invoke("inspiration:send", { conversationId: "conversation-1", requestId: "missing-send", presetId: "chat", message: "不能新建替身" })).rejects.toThrow("已经不存在");
    expect(fixture.chat).toHaveBeenCalledOnce();
  });

  it("serializes a conversation and exports its stable previous answer during regeneration", async () => {
    const fixture = inspirationFixture();
    const pending = fixture.invoke("inspiration:regenerate", { conversationId: "conversation-1", requestId: "export-active", modelId: "chosen-model", settings: { creativity: "precise", responseLength: "brief" } });
    await expect(fixture.invoke("inspiration:send", { conversationId: "conversation-1", requestId: "duplicate-conversation", presetId: "chat", message: "第二个请求" })).rejects.toThrow("仍在生成");
    await expect(fixture.invoke("inspiration:update-source", { conversationId: "conversation-1", sourceWorkId: null })).rejects.toThrow("正在使用参考图");
    await fixture.invoke("inspiration:copy-message", { conversationId: "conversation-1", messageId: "conversation-1-reply", content: "伪造文本", path: "E:\\arbitrary.md" });
    expect(fixture.output.copyText).toHaveBeenLastCalledWith("稳定旧回答");
    await fixture.invoke("inspiration:export-markdown", { conversationId: "conversation-1" });
    const markdown = vi.mocked(fixture.output.saveMarkdown).mock.calls[0]![1];
    expect(markdown).toContain("稳定旧回答");
    expect(markdown).toContain("本轮仍在生成");
    expect(markdown).not.toContain("伪造文本");
    fixture.finish(0, "新稳定回答"); const updated = await pending as InspirationConversation;
    expect(updated.messages.at(-1)?.provenance).toMatchObject({ modelId: "actual-model", modelVersion: "v1", settings: { creativity: "precise", responseLength: "brief" }, parameters: { temperature: 0.35, maxTokens: 600 }, source: null });
    expect(fixture.chat.mock.calls[0]![0]).toMatchObject({ modelId: "chosen-model", messages: [{ role: "user", content: "旧提问" }] });
  });

  it("rejects messages belonging to another conversation and user/pending message IDs", async () => {
    const fixture = inspirationFixture([stableConversation("first"), stableConversation("second")]);
    await expect(fixture.invoke("inspiration:export-markdown", { conversationId: "first", messageId: "second-reply" })).rejects.toThrow("已经不存在");
    await expect(fixture.invoke("inspiration:copy-message", { conversationId: "first", messageId: "first-user" })).rejects.toThrow("已经不存在");
    await expect(fixture.invoke("inspiration:copy-markdown", { conversationId: "first", messageId: "pending-renderer-message" })).rejects.toThrow("已经不存在");
    expect(fixture.output.copyText).not.toHaveBeenCalled();
    expect(fixture.output.saveMarkdown).not.toHaveBeenCalled();
  });

  it("retries an unanswered persisted question without duplicating its user bubble", async () => {
    const fixture = inspirationFixture();
    const failed = fixture.invoke("inspiration:send", { conversationId: "conversation-1", requestId: "retry-failure", presetId: "chat", message: "需要重试的问题" });
    const rejected = expect(failed).rejects.toThrow("failure");
    fixture.pending[0]!.reject(new Error("failure")); await rejected;
    const retry = fixture.invoke("inspiration:send", { conversationId: "conversation-1", requestId: "retry-success", presetId: "chat", message: "需要重试的问题" });
    fixture.finish(1, "重试成功"); await retry;
    expect(fixture.stored()[0]?.messages.filter((message) => message.content === "需要重试的问题")).toHaveLength(1);
  });

  it("renames a conversation and uses work-based titles when starting with built-in starter prompts", async () => {
    const fixture = inspirationFixture([]);
    const starter = "请认真看看这张图，先说说你看到了什么，再聊聊它可能正在发生什么。";
    const sendPromise = fixture.invoke("inspiration:send", {
      requestId: "starter-title",
      presetId: "image_chat",
      message: starter
    });
    fixture.finish(0, "回答");
    const created = await sendPromise as InspirationConversation;
    expect(created.title).toContain("聊图");

    const renamed = await fixture.invoke("inspiration:rename", {
      conversationId: created.id,
      title: "  我的自定义标题  "
    }) as InspirationConversation;
    expect(renamed.title).toBe("我的自定义标题");
    expect(fixture.stored()[0]?.title).toBe("我的自定义标题");
    await expect(fixture.invoke("inspiration:rename", { conversationId: created.id, title: "   " })).rejects.toThrow();
  });
});

