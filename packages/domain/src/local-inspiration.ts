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
}

export interface InspirationConversation {
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
  conversationId: string;
  sourceWorkId: string | null;
  sourcePageIndex?: number;
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
