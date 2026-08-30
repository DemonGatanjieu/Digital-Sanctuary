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
  messages: InspirationMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface InspirationSendRequest {
  conversationId?: string;
  requestId: string;
  presetId: InspirationPresetId;
  message: string;
  sourceWorkId?: string;
  sourcePageIndex?: number;
}

export interface InspirationRegenerateRequest {
  conversationId: string;
  requestId: string;
}

export interface InspirationSourceUpdateRequest {
  conversationId: string;
  sourceWorkId: string | null;
  sourcePageIndex?: number;
}

export function isInspirationPresetId(value: unknown): value is InspirationPresetId {
  return typeof value === "string" && (INSPIRATION_PRESET_IDS as readonly string[]).includes(value);
}
