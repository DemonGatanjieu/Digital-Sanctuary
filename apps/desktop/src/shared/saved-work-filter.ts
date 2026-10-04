import type { SavedWorkFilterDraft, SavedWorkFilterQuery } from "@sanctuary/domain";
import { parseWorkQuery } from "./library-query.js";

export function savedFilterQuery(value: unknown): SavedWorkFilterQuery {
  const { offset: _offset, limit: _limit, ...query } = parseWorkQuery(value);
  return { ...query, sortBy: query.sortBy ?? "savedAt", direction: query.direction ?? "desc" };
}
export function parseSavedWorkFilterDraft(value: unknown): SavedWorkFilterDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<SavedWorkFilterDraft>;
  if (typeof draft.name !== "string" || !draft.name.trim() || draft.name.trim().length > 80 ||
      !draft.query || typeof draft.query !== "object" || Array.isArray(draft.query)) return null;
  return { name: draft.name.trim(), query: savedFilterQuery(draft.query) };
}
