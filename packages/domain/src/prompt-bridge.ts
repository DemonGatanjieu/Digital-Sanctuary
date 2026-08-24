export type PromptTagRole = "positive" | "ignored" | "negative";

export type PromptModelProfileId = "danbooru" | "sdxl-illustration" | "flux-natural";

export interface PromptModelProfile {
  id: PromptModelProfileId;
  name: string;
  description: string;
}

export const PROMPT_MODEL_PROFILES: readonly PromptModelProfile[] = [
  {
    id: "danbooru",
    name: "保留标签格式",
    description: "保留 WD / Danbooru 标签结构，适合标签型插画工作流。"
  },
  {
    id: "sdxl-illustration",
    name: "插画用语",
    description: "把下划线转换为空格，不根据识别百分比添加生成权重。"
  },
  {
    id: "flux-natural",
    name: "简洁自然语言",
    description: "将选中的画面元素整理为一句简洁英文描述。"
  }
] as const;

export interface PromptPreset {
  id: string;
  name: string;
  modelProfile: PromptModelProfileId;
  negativeLibrary: string[];
  createdAt: string;
}

export interface PromptWorkspacePreferences {
  version: 2;
  modelProfile: PromptModelProfileId;
  negativeLibrary: string[];
  presets: PromptPreset[];
}

export interface PromptPreview {
  rawTags: string;
  positivePrompt: string;
  negativePrompt: string;
  positiveTags: string[];
  negativeTags: string[];
  ignoredTags: string[];
}

export const DEFAULT_PROMPT_WORKSPACE: PromptWorkspacePreferences = {
  version: 2,
  modelProfile: "danbooru",
  negativeLibrary: [],
  presets: []
};

export const DEFAULT_PROMPT_MINIMUM_CONFIDENCE = 0.2;
export const DEFAULT_PROMPT_POSITIVE_CONFIDENCE = 0.4;

const MAX_PRESETS = 30;
const MAX_LIBRARY_ITEMS = 80;

export function normalizePromptTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 120);
}

export function normalizePromptWorkspace(value: unknown): PromptWorkspacePreferences {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_PROMPT_WORKSPACE);
  const input = value as Partial<PromptWorkspacePreferences>;
  const modelProfile = isPromptModelProfileId(input.modelProfile) ? input.modelProfile : "danbooru";
  const negativeLibrary = normalizeStringList(input.negativeLibrary, MAX_LIBRARY_ITEMS, 160);
  const presets = Array.isArray(input.presets)
    ? input.presets.flatMap((preset) => normalizePromptPreset(preset) ?? []).slice(0, MAX_PRESETS)
    : [];
  return { version: 2, modelProfile, negativeLibrary, presets };
}

export function defaultPromptTagRole(
  confidence: number,
  positiveConfidence = DEFAULT_PROMPT_POSITIVE_CONFIDENCE
): PromptTagRole {
  return Number.isFinite(confidence) && confidence >= positiveConfidence ? "positive" : "ignored";
}

export function composePromptPreview(
  labels: Record<string, number>,
  preferences: PromptWorkspacePreferences,
  minimumConfidence = DEFAULT_PROMPT_MINIMUM_CONFIDENCE,
  tagRoles: Readonly<Record<string, PromptTagRole>> = {}
): PromptPreview {
  const normalized = normalizePromptWorkspace(preferences);
  const entries = Object.entries(labels)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]) && entry[1] >= minimumConfidence)
    .map(([tag, confidence]) => ({ tag: normalizePromptTag(tag), confidence }))
    .filter(({ tag }) => Boolean(tag))
    .sort((left, right) => right.confidence - left.confidence || left.tag.localeCompare(right.tag));

  const roleOf = ({ tag, confidence }: { tag: string; confidence: number }): PromptTagRole =>
    isPromptTagRole(tagRoles[tag]) ? tagRoles[tag] : defaultPromptTagRole(confidence);
  const positiveTags = entries.filter((entry) => roleOf(entry) === "positive").map(({ tag }) => tag);
  const negativeTags = entries.filter((entry) => roleOf(entry) === "negative").map(({ tag }) => tag);
  const ignoredTags = entries.filter((entry) => roleOf(entry) === "ignored").map(({ tag }) => tag);
  const rawTags = entries.map(({ tag }) => tag).join(", ");

  const positivePrompt = formatPositivePrompt(positiveTags, normalized.modelProfile);
  const negativePrompt = [
    ...negativeTags.map((tag) => formatTag(tag, normalized.modelProfile)),
    ...normalized.negativeLibrary
  ].filter(Boolean).join(", ");

  return { rawTags, positivePrompt, negativePrompt, positiveTags, negativeTags, ignoredTags };
}

export function createPromptPreset(
  name: string,
  preferences: PromptWorkspacePreferences,
  id: string = crypto.randomUUID(),
  createdAt: string = new Date().toISOString()
): PromptPreset {
  const normalizedName = name.trim().slice(0, 80);
  if (!normalizedName) throw new Error("Preset name is required");
  const normalized = normalizePromptWorkspace(preferences);
  return {
    id: id.trim().slice(0, 100),
    name: normalizedName,
    modelProfile: normalized.modelProfile,
    negativeLibrary: [...normalized.negativeLibrary],
    createdAt
  };
}

export function applyPromptPreset(
  preferences: PromptWorkspacePreferences,
  preset: PromptPreset
): PromptWorkspacePreferences {
  const normalized = normalizePromptWorkspace(preferences);
  return {
    ...normalized,
    modelProfile: preset.modelProfile,
    negativeLibrary: [...preset.negativeLibrary]
  };
}

export function isPromptModelProfileId(value: unknown): value is PromptModelProfileId {
  return value === "danbooru" || value === "sdxl-illustration" || value === "flux-natural";
}

export function isPromptTagRole(value: unknown): value is PromptTagRole {
  return value === "positive" || value === "ignored" || value === "negative";
}

function normalizePromptPreset(value: unknown): PromptPreset | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<PromptPreset>;
  if (typeof input.id !== "string" || typeof input.name !== "string" || typeof input.createdAt !== "string") return null;
  if (!input.id.trim() || !input.name.trim() || !isPromptModelProfileId(input.modelProfile)) return null;
  return {
    id: input.id.trim().slice(0, 100),
    name: input.name.trim().slice(0, 80),
    modelProfile: input.modelProfile,
    negativeLibrary: normalizeStringList(input.negativeLibrary, MAX_LIBRARY_ITEMS, 160),
    createdAt: input.createdAt.slice(0, 40)
  };
}

function normalizeStringList(value: unknown, maximum: number, maximumLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maximumLength))
    .filter(Boolean))].slice(0, maximum);
}

function formatPositivePrompt(tags: string[], profile: PromptModelProfileId): string {
  if (profile === "flux-natural") {
    const terms = tags.slice(0, 60).map((tag) => formatTag(tag, profile));
    return terms.length ? `An illustration featuring ${terms.join(", ")}.` : "";
  }
  return tags.map((tag) => formatTag(tag, profile)).join(", ");
}

function formatTag(tag: string, profile: PromptModelProfileId): string {
  return profile === "danbooru" ? tag : tag.replaceAll("_", " ");
}
