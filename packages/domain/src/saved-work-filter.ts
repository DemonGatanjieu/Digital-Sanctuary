import type { WorkQuery } from "./index.js";
export type SavedWorkFilterQuery = Omit<WorkQuery, "offset" | "limit">;
export interface SavedWorkFilter { id: string; name: string; query: SavedWorkFilterQuery; createdAt: string }
export interface SavedWorkFilterDraft { name: string; query: SavedWorkFilterQuery }
