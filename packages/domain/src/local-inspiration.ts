export const INSPIRATION_PRESET_IDS = [
  "chat",
  "image_chat",
  "story_scene",
  "character_profile",
  "world_building",
  "prompt_notes"
] as const;

export type InspirationPresetId = typeof INSPIRATION_PRESET_IDS[number];
export type InspirationRole = "user" | "assistant";
export type InspirationCreativity = "precise" | "balanced" | "imaginative";
export type InspirationResponseLength = "brief" | "standard" | "detailed";

export interface InspirationGenerationSettings {
  creativity: InspirationCreativity;
  responseLength: InspirationResponseLength;
}

export const DEFAULT_INSPIRATION_SETTINGS: InspirationGenerationSettings = {
  creativity: "balanced",
  responseLength: "standard"
};

export interface InspirationSourceWork {
  workId: string;
  title: string;
  artistName: string | null;
  pageIndex: number;
  imageUrl: string;
}

export interface InspirationMessage {
  id: string;
  role: InspirationRole;
  content: string;
  createdAt: string;
  provenance?: InspirationReplyProvenance;
}

export interface InspirationReplyProvenance {
  sources?: Array<{ workId: string; title: string; artistName: string | null; pageIndex: number }>;
  modelId: string;
  modelVersion: string;
  evaluatorVersion: string;
  settings: InspirationGenerationSettings;
  parameters: { temperature: number; topP: number; topK: number; maxTokens: number };
  source: { workId: string; title: string; artistName: string | null; pageIndex: number } | null;
  durationMs: number;
}

export interface InspirationExportRequest {
  conversationId: string;
  messageId?: string;
}

export interface InspirationExportResult {
  canceled: boolean;
  fileName?: string;
}

export interface InspirationConversation {
  sources?: InspirationSourceWork[];
  id: string;
  title: string;
  presetId: InspirationPresetId;
  source: InspirationSourceWork | null;
  modelId: string | null;
  settings: InspirationGenerationSettings;
  messages: InspirationMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface InspirationSendRequest {
  sources?: Array<{ workId: string; pageIndex: number }>;
  conversationId?: string;
  requestId: string;
  presetId: InspirationPresetId;
  message: string;
  modelId?: string;
  settings?: InspirationGenerationSettings;
  sourceWorkId?: string;
  sourcePageIndex?: number;
}

export interface InspirationRegenerateRequest {
  conversationId: string;
  requestId: string;
  modelId?: string;
  settings?: InspirationGenerationSettings;
}

export interface InspirationSourceUpdateRequest {
  sources?: Array<{ workId: string; pageIndex: number }>;
  conversationId: string;
  sourceWorkId: string | null;
  sourcePageIndex?: number;
}

export interface InspirationRenameRequest {
  conversationId: string;
  title: string;
}

const PRESET_SHORT_LABELS: Record<InspirationPresetId, string> = {
  image_chat: "聊图",
  prompt_notes: "提示词",
  chat: "随聊",
  story_scene: "小说场景",
  character_profile: "角色设定",
  world_building: "世界观"
};

const BUILTIN_STARTER_PREFIXES = [
  "请认真看看这张图",
  "请把画面和我的要求整理成生成提示词",
  "我有一个想法，想和你一起把它梳理清楚",
  "请以这张图或我的描述为起点",
  "请把这个人物发展成可继续创作的角色设定",
  "请从这个画面或想法出发",
  "请逐张看看这些图片"
];

export function isBuiltinStarterMessage(message: string): boolean {
  const normalized = message.trim();
  return BUILTIN_STARTER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function smartConversationTitle(
  message: string,
  presetId: InspirationPresetId,
  sources: ReadonlyArray<{ title: string }> = []
): string {
  const clean = message.replace(/\s+/g, " ").trim();
  const firstTitle = sources[0]?.title?.replace(/\s+/g, " ").trim();
  if (isBuiltinStarterMessage(clean)) {
    if (firstTitle) {
      const scope = sources.length > 1 ? `${firstTitle.slice(0, 14)} 等 ${sources.length} 张` : firstTitle.slice(0, 18);
      return `${scope} · ${PRESET_SHORT_LABELS[presetId]}`;
    }
    return `新的${PRESET_SHORT_LABELS[presetId]}`;
  }
  if (firstTitle && clean.length <= 16 && !clean.includes(firstTitle)) {
    return `${firstTitle.slice(0, 14)} · ${clean}`;
  }
  return clean.slice(0, 26) || "新的灵感";
}

/**
 * Splits an AI reply into positive and negative prompt sections when the reply
 * contains an explicit negative prompt heading or label.
 */
export function extractPromptsFromReply(content: string): {
  positive: string;
  negative: string;
  extracted: boolean;
} {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { positive: "", negative: "", extracted: false };

  const negativeRegex = /(?:^|\n)\s*(?:[#*>-]+\s*)?(?:\*\*)?(?:负向约束|负向提示词|反向提示词|负面提示词|Negative\s*Prompts?|Negative)(?:\*\*)?\s*[：:\n]\s*([\s\S]*?)(?=\n\s*(?:\n|[#>-]+\s*|\*\*[^*\n]+\*\*|(?:变体|主体|环境|构图|光色|材质|正向|说明|总结|备注|补充)[^：\n]{0,6}[：:])|$)/i;
  const match = negativeRegex.exec(normalized);
  if (!match || match.index === undefined) {
    return { positive: normalized.slice(0, 4000), negative: "", extracted: false };
  }

  const rawNegative = (match[1] ?? "")
    .replace(/^[#*>-]+\s*/gm, "")
    .replace(/^```[\w-]*\n?|\n?```$/g, "")
    .trim();
  const withoutNegative = `${normalized.slice(0, match.index)}\n${normalized.slice(match.index + match[0].length)}`.trim();
  const cleanedPositive = withoutNegative
    .replace(/^\s*(?:[#*>-]+\s*)?(?:\*\*)?(?:正向提示词|正向描述|Positive\s*Prompts?)(?:\*\*)?\s*[：:]\s*/gim, "")
    .trim();

  if (!rawNegative || !cleanedPositive) {
    return { positive: normalized.slice(0, 4000), negative: "", extracted: false };
  }

  return {
    positive: cleanedPositive.slice(0, 4000),
    negative: rawNegative.slice(0, 2000),
    extracted: true
  };
}


export function isInspirationPresetId(value: unknown): value is InspirationPresetId {
  return typeof value === "string" && (INSPIRATION_PRESET_IDS as readonly string[]).includes(value);
}

export function isInspirationGenerationSettings(value: unknown): value is InspirationGenerationSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<InspirationGenerationSettings>;
  return ["precise", "balanced", "imaginative"].includes(settings.creativity ?? "") &&
    ["brief", "standard", "detailed"].includes(settings.responseLength ?? "");
}

