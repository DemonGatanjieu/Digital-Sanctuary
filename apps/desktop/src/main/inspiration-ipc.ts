import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { BrowserWindow, IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import {
  DEFAULT_INSPIRATION_SETTINGS,
  isInspirationGenerationSettings,
  isInspirationPresetId,
  isSafeModelId,
  type InspirationConversation,
  type InspirationGenerationSettings,
  type InspirationMessage,
  type InspirationPresetId,
  type InspirationRegenerateRequest,
  type InspirationSendRequest,
  type InspirationSourceUpdateRequest,
  type InspirationSourceWork
} from "@sanctuary/domain";
import type { LocalArtCriticService } from "./vision/local-art-critic-service.js";
import { prepareVisionImage } from "./vision/vision-image-preprocessor.js";
import { readClipboardImageSize } from "./clipboard-image-size.js";
import { createInspirationOutputHost, inspirationMarkdown, inspirationMarkdownFileName, type InspirationOutputHost } from "./inspiration-export.js";

const STORE_KEY = "local_inspiration_conversations_v1";
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES = 80;
const MAX_CONTEXT_MESSAGES = 16;
const MAX_CONTEXT_CHARACTERS = 12_000;
const activeRequests = new Map<string, { controller: AbortController; conversationId: string }>();

export function registerInspirationIpc(
  ipc: IpcMain,
  database: LibraryDatabase,
  localModel: LocalArtCriticService | undefined,
  getWindow?: () => BrowserWindow | null | undefined,
  output: InspirationOutputHost = createInspirationOutputHost(getWindow)
): void {
  ipc.handle("inspiration:list", () => loadConversations(database));
  ipc.handle("inspiration:send", async (_event, raw: InspirationSendRequest) => {
    if (!localModel) throw new Error("本地灵感服务尚未初始化");
    const request = parseSendRequest(raw);
    if (activeRequests.has(request.requestId)) throw new Error("这个生成请求已经在运行");
    let conversations = loadConversations(database);
    let conversation = request.conversationId
      ? conversations.find((item) => item.id === request.conversationId) ?? null
      : null;
    if (request.conversationId && !conversation) throw new Error("这段对话已经不存在，请新建对话");
    if (!conversation) {
      conversation = createConversation(database, request);
      conversations = [conversation, ...conversations];
    }
    if (conversationIsGenerating(conversation.id)) throw new Error("这段对话仍在生成，请先停止或等待完成");
    const lastMessage = conversation.messages.at(-1);
    const retrying = lastMessage?.role === "user" && lastMessage.content === request.message;
    const userMessage = retrying ? lastMessage : makeMessage("user", request.message);
    if (!retrying) conversation.messages.push(userMessage);
    conversation.presetId = request.presetId;
    if (request.modelId) conversation.modelId = request.modelId;
    conversation.settings = normalizeSettings(request.settings ?? conversation.settings);
    conversation.updatedAt = userMessage.createdAt;
    if (conversation.messages.filter((item) => item.role === "user").length === 1) {
      conversation.title = titleFromMessage(request.message);
    }
    const controller = new AbortController();
    activeRequests.set(request.requestId, { controller, conversationId: conversation.id });
    try {
      persistConversations(database, conversations);
      return await generateReply(database, localModel, conversation, controller.signal);
    } finally {
      activeRequests.delete(request.requestId);
    }
  });
  ipc.handle("inspiration:regenerate", async (_event, raw: InspirationRegenerateRequest) => {
    if (!localModel) throw new Error("本地灵感服务尚未初始化");
    const requestId = requireId(raw?.requestId, "请求 ID");
    const conversationId = requireId(raw?.conversationId, "会话 ID");
    if (activeRequests.has(requestId)) throw new Error("这个生成请求已经在运行");
    const conversations = loadConversations(database);
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error("找不到这段对话");
    if (conversationIsGenerating(conversation.id)) throw new Error("这段对话仍在生成，请先停止或等待完成");
    while (conversation.messages.at(-1)?.role === "assistant") conversation.messages.pop();
    if (!conversation.messages.some((item) => item.role === "user")) throw new Error("还没有可以重新生成的提问");
    if (raw.modelId !== undefined) conversation.modelId = parseOptionalModelId(raw.modelId);
    conversation.settings = normalizeSettings(raw.settings ?? conversation.settings);
    const controller = new AbortController();
    activeRequests.set(requestId, { controller, conversationId });
    try {
      // The previous stable answer stays persisted until its replacement succeeds.
      return await generateReply(database, localModel, conversation, controller.signal);
    } finally {
      activeRequests.delete(requestId);
    }
  });
  ipc.handle("inspiration:cancel", (_event, requestId: unknown) => {
    const request = activeRequests.get(requireId(requestId, "请求 ID"));
    if (!request) return false;
    request.controller.abort();
    return true;
  });
  ipc.handle("inspiration:update-source", (_event, raw: InspirationSourceUpdateRequest) => {
    if (!raw || typeof raw !== "object") throw new Error("参考图请求格式不正确");
    const conversationId = requireId(raw.conversationId, "会话 ID");
    const conversations = loadConversations(database);
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error("找不到这段对话");
    if (conversationIsGenerating(conversation.id)) throw new Error("本轮正在使用参考图，请先停止或等待完成");
    conversation.sources = raw.sources !== undefined ? resolveSources(database, raw.sources) : raw.sourceWorkId === null ? [] : [resolveSource(database, requireId(raw.sourceWorkId, "作品 ID"), raw.sourcePageIndex)];
    conversation.source = conversation.sources[0] ?? null;
    conversation.updatedAt = new Date().toISOString();
    persistConversations(database, conversations);
    return conversation;
  });
  ipc.handle("inspiration:delete", (_event, conversationId: unknown) => {
    const id = requireId(conversationId, "会话 ID");
    for (const request of activeRequests.values()) {
      if (request.conversationId === id) request.controller.abort();
    }
    const current = loadConversations(database);
    const next = current.filter((item) => item.id !== id);
    persistConversations(database, next);
    return next.length !== current.length;
  });
  ipc.handle("inspiration:copy-message", async (_event, raw: unknown) => {
    const { message } = resolveExport(database, raw, true);
    await output.copyText(message!.content);
  });
  ipc.handle("inspiration:copy-markdown", async (_event, raw: unknown) => {
    const { conversation, message } = resolveExport(database, raw);
    await output.copyText(inspirationMarkdown(conversation, message, conversationIsGenerating(conversation.id)));
  });
  ipc.handle("inspiration:export-markdown", async (_event, raw: unknown) => {
    const { conversation, message } = resolveExport(database, raw);
    const markdown = inspirationMarkdown(conversation, message, conversationIsGenerating(conversation.id));
    return output.saveMarkdown(inspirationMarkdownFileName(conversation.title, Boolean(message)), markdown);
  });
}

async function generateReply(
  database: LibraryDatabase,
  localModel: LocalArtCriticService,
  conversation: InspirationConversation,
  signal: AbortSignal
): Promise<InspirationConversation> {
  const startedAt = Date.now();
  const sources = conversation.sources ?? (conversation.source ? [conversation.source] : []);
  if (sources.length > 4) throw new Error("一次最多讨论 4 张参考图");
  if (sources.length && (conversation.messages.at(-1)?.content.length ?? 0) > 2000) throw new Error("带图讨论的单次输入请控制在 2000 字以内，可以分几次提问");
  const prepared: Awaited<ReturnType<typeof prepareVisionImage>>[] = [];
  try {
    for (const source of sources) {
      if (signal.aborted) throw new Error("本轮生成已停止");
      const work = database.getWork(source.workId);
      const asset = work?.assets.find(item => item.pageIndex === source.pageIndex && item.mediaType === "image" && item.fileState === "available");
      if (!asset) throw new Error(`参考图《${source.title}》已经不可用，请重新选择参考图`);
      const info = await stat(asset.path).catch(() => { throw new Error(`无法读取参考图《${source.title}》，请检查原文件位置和读取权限`); });
      if (info.size > 32 * 1024 * 1024) throw new Error(`参考图《${source.title}》超过 32 MB，请选择较小的图片进行讨论`);
      const dimensions = await readClipboardImageSize(asset.path).catch(() => { throw new Error(`参考图《${source.title}》已变化或无法读取，请重新选择`); });
      if (!dimensions) throw new Error(`参考图《${source.title}》暂不能读图，请转换成 PNG、JPG 或 WebP 后导入`);
      if (dimensions.width * dimensions.height > 32_000_000) throw new Error(`参考图《${source.title}》尺寸过大，请缩小后再讨论`);
      prepared.push(await prepareVisionImage(asset.path, { maxLongEdge: sources.length > 1 ? 560 : 1344 }));
    }
    if (prepared.reduce((sum, item) => sum + item.byteLength, 0) > 32 * 1024 * 1024) throw new Error("参考图总大小过大，请减少图片数量");
    if (signal.aborted) throw new Error("本轮生成已停止");
    const source = sources[0] ?? null;
    const profile = inspirationGenerationProfile(conversation.settings);
    const result = await localModel.chat({
      systemPrompt: `${presetSystemPrompt(conversation.presetId, prepared.length > 0)}\n\n${profile.instruction}\n${sources.map((item,index) => `图片 ${index + 1}：《${item.title.replace(/[\r\n]/g," ")}》第 ${item.pageIndex + 1} 页`).join("\n")}\n多图时请用图片编号区分内容，用户没有要求时不要臆测图片之间的关系。`,
      messages: boundedContext(conversation.messages, sources.length ? 2200 : 3500),
      ...(prepared.length === 1 ? { image: prepared[0]! } : prepared.length ? { images: prepared } : {}),
      ...(conversation.modelId ? { modelId: conversation.modelId } : {}),
      temperature: profile.temperature,
      topP: profile.topP,
      topK: profile.topK,
      maxTokens: profile.maxTokens
    }, signal);
    if (signal.aborted) throw new Error("本轮生成已停止，已有回答已保留");
    const assistantMessage = makeMessage("assistant", result.content);
    assistantMessage.provenance = {
      ...result.identity,
      settings: { ...conversation.settings },
      parameters: { temperature: profile.temperature, topP: profile.topP, topK: profile.topK, maxTokens: profile.maxTokens },
      source: source ? { workId: source.workId, title: source.title, artistName: source.artistName, pageIndex: source.pageIndex } : null,
      sources: sources.map(({workId,title,artistName,pageIndex}) => ({workId,title,artistName,pageIndex})),
      durationMs: Math.max(0, Date.now() - startedAt)
    };
    conversation.messages.push(assistantMessage);
    conversation.modelId = result.identity.modelId;
    conversation.updatedAt = assistantMessage.createdAt;
    conversation.messages = conversation.messages.slice(-MAX_MESSAGES);
    // Re-read before committing so another conversation's changes/deletion survive.
    const conversations = loadConversations(database);
    if (!conversations.some((item) => item.id === conversation.id)) throw new Error("这段对话已删除，未保存新的回答");
    persistConversations(database, conversations.map((item) => item.id === conversation.id ? conversation : item));
    return conversation;
  } catch (error) {
    if (signal.aborted) throw new Error("本轮生成已停止，已保存内容已保留");
    throw error;
  } finally {
    for (const image of prepared) image.cleanup();
  }
}

function createConversation(database: LibraryDatabase, request: InspirationSendRequest): InspirationConversation {
  const now = new Date().toISOString();
  const sources = request.sources !== undefined ? resolveSources(database, request.sources) : request.sourceWorkId ? [resolveSource(database, request.sourceWorkId, request.sourcePageIndex)] : [];
  return {
    sources,
    id: randomUUID(),
    title: titleFromMessage(request.message),
    presetId: request.presetId,
    source: sources[0] ?? null,
    modelId: request.modelId ?? null,
    settings: normalizeSettings(request.settings),
    messages: [],
    createdAt: now,
    updatedAt: now
  };
}

function resolveSource(
  database: LibraryDatabase,
  workId: string,
  requestedPageIndex: number | undefined
): InspirationSourceWork {
  const work = database.getWork(workId);
  if (!work) throw new Error("这张画廊作品已经不存在");
  const available = work.assets.filter((asset) => asset.mediaType === "image" && asset.fileState === "available");
  if (available.length === 0) throw new Error("这件作品没有可用的本地图片");
  const wantedPage = Number.isInteger(requestedPageIndex) ? Math.max(0, Math.trunc(requestedPageIndex!)) : 0;
  const asset = available.find((item) => item.pageIndex === wantedPage) ?? available[0]!;
  return {
    workId: work.id,
    title: work.title,
    artistName: work.artistName,
    pageIndex: asset.pageIndex,
    imageUrl: `sanctuary-image://local/${encodeURIComponent(asset.path)}`
  };
}

function resolveSources(database: LibraryDatabase, raw: unknown): InspirationSourceWork[] {
  const sources = parseSources(raw);
  return sources.map(item => {
    const work = database.getWork(item.workId);
    if (!work?.assets.some(asset => asset.pageIndex === item.pageIndex && asset.mediaType === "image" && asset.fileState === "available")) throw new Error("所选参考页已经不可用，请重新选择");
    return resolveSource(database, item.workId, item.pageIndex);
  });
}
function parseSources(raw: unknown): Array<{workId:string;pageIndex:number}> {
  if (!Array.isArray(raw) || raw.length > 4) throw new Error("一次最多讨论 4 张参考图");
  const result = raw.map(item => {
    if (!item || typeof item !== "object" || !Number.isSafeInteger(item.pageIndex) || item.pageIndex < 0 || item.pageIndex > 100000) throw new Error("参考页格式不正确");
    return { workId: requireId(item.workId,"作品 ID"), pageIndex: item.pageIndex as number };
  });
  if (new Set(result.map(item => `${item.workId}:${item.pageIndex}`)).size !== result.length) throw new Error("参考图重复，请保留一份");
  return result;
}

function parseSendRequest(raw: InspirationSendRequest): InspirationSendRequest {
  if (!raw || typeof raw !== "object") throw new Error("灵感请求格式不正确");
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  if (!message) throw new Error("先写一点想和模型说的话吧");
  if (message.length > 8_000) throw new Error("单次输入不能超过 8000 个字符");
  if (!isInspirationPresetId(raw.presetId)) throw new Error("未知的创作方式");
  return {
    requestId: requireId(raw.requestId, "请求 ID"),
    presetId: raw.presetId,
    message,
    ...(raw.sources !== undefined ? { sources: parseSources(raw.sources) } : {}),
    ...(raw.modelId ? { modelId: parseOptionalModelId(raw.modelId) } : {}),
    ...(raw.settings ? { settings: normalizeSettings(raw.settings) } : {}),
    ...(raw.conversationId ? { conversationId: requireId(raw.conversationId, "会话 ID") } : {}),
    ...(raw.sourceWorkId ? { sourceWorkId: requireId(raw.sourceWorkId, "作品 ID") } : {}),
    ...(Number.isInteger(raw.sourcePageIndex) ? { sourcePageIndex: raw.sourcePageIndex } : {})
  };
}

function loadConversations(database: LibraryDatabase): InspirationConversation[] {
  const stored = database.getPreference<unknown>(STORE_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(isConversation).slice(0, MAX_CONVERSATIONS).map((conversation) => ({
    ...conversation,
    settings: normalizeSettings(conversation.settings),
    messages: conversation.messages.filter(isMessage).slice(-MAX_MESSAGES).map((message) => ({ ...message }))
  }));
}

function persistConversations(database: LibraryDatabase, conversations: InspirationConversation[]): void {
  const bounded = [...conversations]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_CONVERSATIONS)
    .map((conversation) => ({ ...conversation, messages: conversation.messages.slice(-MAX_MESSAGES) }));
  database.setPreference(STORE_KEY, bounded);
}

function isConversation(value: unknown): value is InspirationConversation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<InspirationConversation>;
  return typeof item.id === "string" && typeof item.title === "string" &&
    isInspirationPresetId(item.presetId) && Array.isArray(item.messages) &&
    typeof item.createdAt === "string" && typeof item.updatedAt === "string";
}

function isMessage(value: unknown): value is InspirationMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<InspirationMessage>;
  return typeof item.id === "string" && ["user", "assistant"].includes(item.role ?? "") &&
    typeof item.content === "string" && item.content.length > 0 && item.content.length <= 100_000 &&
    typeof item.createdAt === "string";
}

function conversationIsGenerating(conversationId: string): boolean {
  return [...activeRequests.values()].some((request) => request.conversationId === conversationId);
}

function resolveExport(database: LibraryDatabase, raw: unknown, requireMessage = false): {
  conversation: InspirationConversation; message?: InspirationMessage;
} {
  if (!raw || typeof raw !== "object") throw new Error("导出请求格式不正确");
  const request = raw as { conversationId?: unknown; messageId?: unknown };
  const conversationId = requireId(request.conversationId, "会话 ID");
  const conversation = loadConversations(database).find((item) => item.id === conversationId);
  if (!conversation) throw new Error("这段对话已经不存在");
  if (request.messageId !== undefined || requireMessage) {
    const messageId = requireId(request.messageId, "回答 ID");
    const message = conversation.messages.find((item) => item.id === messageId && item.role === "assistant");
    if (!message) throw new Error("这条已完成回答已经不存在");
    return { conversation, message };
  }
  if (conversation.messages.length === 0) throw new Error("还没有已保存的消息可以导出");
  return { conversation };
}

function boundedContext(messages: InspirationMessage[], limit = MAX_CONTEXT_CHARACTERS): Array<{ role: "user" | "assistant"; content: string }> {
  const selected: InspirationMessage[] = [];
  let characters = 0;
  for (let index = messages.length - 1; index >= 0 && selected.length < MAX_CONTEXT_MESSAGES; index -= 1) {
    const message = messages[index]!;
    if (characters + message.content.length > limit && selected.length > 0) break;
    selected.unshift(message);
    characters += message.content.length;
  }
  return selected.map(({ role, content }) => ({ role, content }));
}

function makeMessage(role: "user" | "assistant", content: string): InspirationMessage {
  return { id: randomUUID(), role, content, createdAt: new Date().toISOString() };
}

function titleFromMessage(message: string): string {
  return message.replace(/\s+/g, " ").slice(0, 26) || "新的灵感";
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 100) throw new Error(`${label}格式不正确`);
  return value.trim();
}

function parseOptionalModelId(value: unknown): string {
  if (!isSafeModelId(value)) throw new Error("所选模型 ID 格式不正确");
  return value;
}

function normalizeSettings(value: unknown): InspirationGenerationSettings {
  return isInspirationGenerationSettings(value) ? value : { ...DEFAULT_INSPIRATION_SETTINGS };
}

export function inspirationGenerationProfile(settings: InspirationGenerationSettings): {
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  instruction: string;
} {
  const creativity = {
    precise: { temperature: 0.35, topP: 0.82, topK: 32, text: "回答应更克制、准确，少做无依据的发挥。" },
    balanced: { temperature: 0.65, topP: 0.9, topK: 40, text: "在准确理解和有趣发挥之间保持平衡。" },
    imaginative: { temperature: 1, topP: 0.95, topK: 64, text: "可以大胆联想并提供更有个性的创作选择，但仍要遵守用户给定事实。" }
  }[settings.creativity];
  const length = {
    brief: { maxTokens: 600, text: "回答保持简短，优先给出最有用的核心内容。" },
    standard: { maxTokens: 1400, text: "回答采用适中的完整篇幅，不故意凑字数。" },
    detailed: { maxTokens: 2200, text: "可以充分展开细节和结构，但避免重复同一观点。" }
  }[settings.responseLength];
  return { ...creativity, maxTokens: length.maxTokens, instruction: `${creativity.text}${length.text}` };
}

export function presetSystemPrompt(preset: InspirationPresetId, hasImage: boolean): string {
  const imageRule = hasImage
    ? "你可以看到用户从本地画廊带来的参考图。先准确理解可见内容，再响应用户；不确定的地方明确说是推测。"
    : "当前没有参考图，不要假装自己看到了图片。";
  const common = `你是“纯净领域”的完全本地创作伙伴。${imageRule} 使用自然、具体、有审美判断的中文，避免客服套话和无意义免责声明。`;
  const instructions: Record<InspirationPresetId, string> = {
    chat: "直接与用户讨论想法；必要时主动提出一两个真正有帮助的延伸方向。",
    image_chat: "围绕画面主体、细节、氛围、叙事线索和用户问题展开，不要机械罗列标签。",
    story_scene: "把用户想法或参考图发展成可直接阅读的小说片段，重视动作、感官、节奏与人物语气。默认写一个完整场景，不写创作说明。",
    character_profile: "整理为可用于继续创作的人物设定，包含外观辨识点、性格张力、动机、关系钩子与可发展的矛盾。",
    world_building: "把素材发展成能支撑故事的世界观，关注规则、环境、生活细节、冲突来源和视觉母题。",
    prompt_notes: "把自然语言和可见画面整理为清晰的生成提示词笔记，区分主体、环境、构图、光色、材质与负向约束；不要把识别置信度当生成权重。"
  };
  return `${common}\n\n${instructions[preset]}`;
}
