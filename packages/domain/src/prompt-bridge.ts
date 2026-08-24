export type TagDisposition = "favorite" | "neutral" | "avoid";

export type PromptModelProfileId = "danbooru" | "sdxl-illustration" | "flux-natural";

export interface PromptModelProfile {
  id: PromptModelProfileId;
  name: string;
  description: string;
}

export const PROMPT_MODEL_PROFILES: readonly PromptModelProfile[] = [
  {
    id: "danbooru",
    name: "Danbooru 标签",
    description: "保留 WD 标签结构，适合以标签为主的插画模型。"
  },
  {
    id: "sdxl-illustration",
    name: "SDXL 插画",
    description: "转换下划线并轻度强调喜欢的元素。"
  },
  {
    id: "flux-natural",
    name: "FLUX 自然语言",
    description: "将标签整理为简洁的自然语言画面描述。"
  }
] as const;

export interface PromptPreset {
  id: string;
  name: string;
  modelProfile: PromptModelProfileId;
  dispositions: Record<string, TagDisposition>;
  negativeLibrary: string[];
  createdAt: string;
}

export interface PromptWorkspacePreferences {
  version: 1;
  modelProfile: PromptModelProfileId;
  dispositions: Record<string, TagDisposition>;
  negativeLibrary: string[];
  presets: PromptPreset[];
}

export interface PromptPreview {
  rawTags: string;
  positivePrompt: string;
  negativePrompt: string;
  positiveTags: string[];
  negativeTags: string[];
}

export const DEFAULT_PROMPT_WORKSPACE: PromptWorkspacePreferences = {
  version: 1,
  modelProfile: "danbooru",
  dispositions: {},
  negativeLibrary: [],
  presets: []
};

const MAX_TAGS = 2_000;
const MAX_PRESETS = 30;
const MAX_LIBRARY_ITEMS = 80;

export function normalizePromptTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 120);
}

export function normalizePromptWorkspace(value: unknown): PromptWorkspacePreferences {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_PROMPT_WORKSPACE);
  const input = value as Partial<PromptWorkspacePreferences>;
  const modelProfile = isPromptModelProfileId(input.modelProfile) ? input.modelProfile : "danbooru";
  const dispositions = normalizeDispositions(input.dispositions);
  const negativeLibrary = normalizeStringList(input.negativeLibrary, MAX_LIBRARY_ITEMS, 160);
  const presets = Array.isArray(input.presets)
    ? input.presets.flatMap((preset) => normalizePromptPreset(preset) ?? []).slice(0, MAX_PRESETS)
    : [];
  return { version: 1, modelProfile, dispositions, negativeLibrary, presets };
}

export function composePromptPreview(
  labels: Record<string, number>,
  preferences: PromptWorkspacePreferences,
  minimumConfidence = 0.2
): PromptPreview {
  const normalized = normalizePromptWorkspace(preferences);
  const entries = Object.entries(labels)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]) && entry[1] >= minimumConfidence)
    .map(([tag, confidence]) => ({ tag: normalizePromptTag(tag), confidence }))
    .filter(({ tag }) => Boolean(tag))
    .sort((left, right) => {
      const leftFavorite = normalized.dispositions[left.tag] === "favorite" ? 1 : 0;
      const rightFavorite = normalized.dispositions[right.tag] === "favorite" ? 1 : 0;
      return rightFavorite - leftFavorite || right.confidence - left.confidence || left.tag.localeCompare(right.tag);
    });

  const positiveTags = entries
    .filter(({ tag }) => normalized.dispositions[tag] !== "avoid")
    .map(({ tag }) => tag);
  const negativeTags = entries
    .filter(({ tag }) => normalized.dispositions[tag] === "avoid")
    .map(({ tag }) => tag);
  const rawTags = entries.map(({ tag }) => tag).join(", ");

  const positivePrompt = formatPositivePrompt(positiveTags, normalized.dispositions, normalized.modelProfile);
  const negativePrompt = [
    ...negativeTags.map((tag) => formatTag(tag, normalized.modelProfile)),
    ...normalized.negativeLibrary
  ].filter(Boolean).join(", ");

  return { rawTags, positivePrompt, negativePrompt, positiveTags, negativeTags };
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
    dispositions: { ...normalized.dispositions },
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
    dispositions: { ...preset.dispositions },
    negativeLibrary: [...preset.negativeLibrary]
  };
}

export function isPromptModelProfileId(value: unknown): value is PromptModelProfileId {
  return value === "danbooru" || value === "sdxl-illustration" || value === "flux-natural";
}

function normalizeDispositions(value: unknown): Record<string, TagDisposition> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, TagDisposition> = {};
  for (const [rawTag, disposition] of Object.entries(value).slice(0, MAX_TAGS)) {
    const tag = normalizePromptTag(rawTag);
    if (tag && (disposition === "favorite" || disposition === "neutral" || disposition === "avoid")) {
      if (disposition !== "neutral") result[tag] = disposition;
    }
  }
  return result;
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
    dispositions: normalizeDispositions(input.dispositions),
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

function formatPositivePrompt(
  tags: string[],
  dispositions: Record<string, TagDisposition>,
  profile: PromptModelProfileId
): string {
  if (profile === "flux-natural") {
    const terms = tags.slice(0, 60).map((tag) => formatTag(tag, profile));
    return terms.length ? `An illustration featuring ${terms.join(", ")}.` : "";
  }
  return tags
    .map((tag) => {
      const formatted = formatTag(tag, profile);
      return profile === "sdxl-illustration" && dispositions[tag] === "favorite"
        ? `(${formatted}:1.15)`
        : formatted;
    })
    .join(", ");
}

function formatTag(tag: string, profile: PromptModelProfileId): string {
  return profile === "danbooru" ? tag : tag.replaceAll("_", " ");
}
