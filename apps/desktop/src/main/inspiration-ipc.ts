import { randomUUID } from "node:crypto";
import type { IpcMain } from "electron";
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

const STORE_KEY = "local_inspiration_conversations_v1";
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES = 80;
const MAX_CONTEXT_MESSAGES = 16;
const MAX_CONTEXT_CHARACTERS = 12_000;
const activeRequests = new Map<string, AbortController>();

export function registerInspirationIpc(
  ipc: IpcMain,
  database: LibraryDatabase,
  localModel: LocalArtCriticService | undefined
): void {
  ipc.handle("inspiration:list", () => loadConversations(database));
  ipc.handle("inspiration:send", async (_event, raw: InspirationSendRequest) => {
    if (!localModel) throw new Error("本地灵感服务尚未初始化");
    const request = parseSendRequest(raw);
    if (activeRequests.has(request.requestId)) throw new Error("这个生成请求已经在运行");
    const controller = new AbortController();
    activeRequests.set(request.requestId, controller);
    let conversations = loadConversations(database);
    let conversation = request.conversationId
      ? conversations.find((item) => item.id === request.conversationId) ?? null
      : null;
    if (!conversation) {
      conversation = createConversation(database, request);
      conversations = [conversation, ...conversations];
    }
    const userMessage = makeMessage("user", request.message);
    conversation.messages.push(userMessage);
    conversation.presetId = request.presetId;
    if (request.modelId) conversation.modelId = request.modelId;
    conversation.settings = normalizeSettings(request.settings ?? conversation.settings);
    conversation.updatedAt = userMessage.createdAt;
    if (conversation.messages.filter((item) => item.role === "user").length === 1) {
      conversation.title = titleFromMessage(request.message);
    }
    persistConversations(database, conversations);
    try {
      return await generateReply(database, localModel, conversations, conversation, controller.signal);
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
    while (conversation.messages.at(-1)?.role === "assistant") conversation.messages.pop();
    if (!conversation.messages.some((item) => item.role === "user")) throw new Error("还没有可以重新生成的提问");
    if (raw.modelId !== undefined) conversation.modelId = parseOptionalModelId(raw.modelId);
    conversation.settings = normalizeSettings(raw.settings ?? conversation.settings);
    const controller = new AbortController();
    activeRequests.set(requestId, controller);
    persistConversations(database, conversations);
    try {
      return await generateReply(database, localModel, conversations, conversation, controller.signal);
    } finally {
      activeRequests.delete(requestId);
    }
  });
  ipc.handle("inspiration:cancel", (_event, requestId: unknown) => {
    const controller = activeRequests.get(requireId(requestId, "请求 ID"));
    if (!controller) return false;
    controller.abort();
    return true;
  });
  ipc.handle("inspiration:update-source", (_event, raw: InspirationSourceUpdateRequest) => {
    if (!raw || typeof raw !== "object") throw new Error("参考图请求格式不正确");
    const conversationId = requireId(raw.conversationId, "会话 ID");
    const conversations = loadConversations(database);
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error("找不到这段对话");
    conversation.source = raw.sourceWorkId === null
      ? null
      : resolveSource(database, requireId(raw.sourceWorkId, "作品 ID"), raw.sourcePageIndex);
    conversation.updatedAt = new Date().toISOString();
    persistConversations(database, conversations);
    return conversation;
  });
  ipc.handle("inspiration:delete", (_event, conversationId: unknown) => {
    const id = requireId(conversationId, "会话 ID");
    const current = loadConversations(database);
    const next = current.filter((item) => item.id !== id);
    persistConversations(database, next);
    return next.length !== current.length;
  });
}

async function generateReply(
  database: LibraryDatabase,
  localModel: LocalArtCriticService,
  conversations: InspirationConversation[],
  conversation: InspirationConversation,
  signal: AbortSignal
): Promise<InspirationConversation> {
  const source = conversation.source;
  const work = source ? database.getWork(source.workId) : null;
  const asset = source
    ? work?.assets.find((item) => item.pageIndex === source.pageIndex) ?? work?.assets[0]
    : undefined;
  const prepared = asset ? await prepareVisionImage(asset.path, { maxLongEdge: 1344 }) : undefined;
  try {
    const profile = inspirationGenerationProfile(conversation.settings);
    const result = await localModel.chat({
      systemPrompt: `${presetSystemPrompt(conversation.presetId, Boolean(prepared))}\n\n${profile.instruction}`,
      messages: boundedContext(conversation.messages),
      ...(prepared ? { image: prepared } : {}),
      ...(conversation.modelId ? { modelId: conversation.modelId } : {}),
      temperature: profile.temperature,
      topP: profile.topP,
      topK: profile.topK,
      maxTokens: profile.maxTokens
    }, signal);
    const assistantMessage = makeMessage("assistant", result.content);
    conversation.messages.push(assistantMessage);
    conversation.modelId = result.identity.modelId;
    conversation.updatedAt = assistantMessage.createdAt;
    persistConversations(database, conversations);
    return conversation;
  } finally {
    prepared?.cleanup();
  }
}

function createConversation(database: LibraryDatabase, request: InspirationSendRequest): InspirationConversation {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: titleFromMessage(request.message),
    presetId: request.presetId,
    source: request.sourceWorkId ? resolveSource(database, request.sourceWorkId, request.sourcePageIndex) : null,
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
    settings: normalizeSettings(conversation.settings)
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

function boundedContext(messages: InspirationMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  const selected: InspirationMessage[] = [];
  let characters = 0;
  for (let index = messages.length - 1; index >= 0 && selected.length < MAX_CONTEXT_MESSAGES; index -= 1) {
    const message = messages[index]!;
    if (characters + message.content.length > MAX_CONTEXT_CHARACTERS && selected.length > 0) break;
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
