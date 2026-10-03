import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  CollectionMatchMode,
  SavedCollectionView,
  SavedCollectionViewDraft,
  SavedCollectionViewQuery
} from "@sanctuary/domain";

interface SavedCollectionViewRow {
  id: string;
  name: string;
  query_json: string;
  created_at: string;
  updated_at: string;
}

export class SavedCollectionViewStore {
  constructor(private readonly database: DatabaseSync) {}

  ensureSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS saved_collection_views (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        query_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_saved_collection_views_created_at
        ON saved_collection_views(created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_collection_views_name_nocase
        ON saved_collection_views(name COLLATE NOCASE);
    `);
  }

  list(): SavedCollectionView[] {
    const rows = this.database
      .prepare("SELECT id, name, query_json, created_at, updated_at FROM saved_collection_views ORDER BY created_at DESC")
      .all() as unknown as SavedCollectionViewRow[];
    return rows.map(mapSavedCollectionView);
  }

  get(id: string): SavedCollectionView | null {
    const row = this.database
      .prepare("SELECT id, name, query_json, created_at, updated_at FROM saved_collection_views WHERE id = ?")
      .get(id) as SavedCollectionViewRow | undefined;
    return row ? mapSavedCollectionView(row) : null;
  }

  create(draft: SavedCollectionViewDraft): SavedCollectionView {
    const normalized = normalizeDraft(draft);
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      this.database
        .prepare(
          "INSERT INTO saved_collection_views (id, name, query_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        )
        .run(id, normalized.name, JSON.stringify(normalized.query), now, now);
    } catch (error) {
      throw translateConstraintError(error, normalized.name);
    }
    const saved = this.get(id);
    if (!saved) throw new Error("Failed to create saved collection view");
    return saved;
  }

  update(id: string, draft: SavedCollectionViewDraft): SavedCollectionView | null {
    if (!this.get(id)) return null;
    const normalized = normalizeDraft(draft);
    try {
      this.database
        .prepare(
          "UPDATE saved_collection_views SET name = ?, query_json = ?, updated_at = ? WHERE id = ?"
        )
        .run(normalized.name, JSON.stringify(normalized.query), new Date().toISOString(), id);
    } catch (error) {
      throw translateConstraintError(error, normalized.name);
    }
    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.database
      .prepare("DELETE FROM saved_collection_views WHERE id = ?")
      .run(id);
    return Number(result.changes) > 0;
  }
}

function normalizeDraft(draft: SavedCollectionViewDraft): { name: string; query: SavedCollectionViewQuery } {
  if (!draft || typeof draft !== "object" || typeof draft.name !== "string") {
    throw new Error("Invalid saved collection view");
  }
  const name = draft.name.trim();
  if (!name || name.length > 80) throw new Error("Saved collection view name must contain 1 to 80 characters");
  if (draft.matchMode !== "all" && draft.matchMode !== "any") {
    throw new Error("Saved collection view match mode must be all or any");
  }
  const includedCollectionIds = normalizeIds(draft.includedCollectionIds);
  const included = new Set(includedCollectionIds);
  const excludedCollectionIds = normalizeIds(draft.excludedCollectionIds).filter((id) => !included.has(id));
  if (includedCollectionIds.length === 0 && excludedCollectionIds.length === 0) {
    throw new Error("Saved collection view requires at least one collection condition");
  }
  return {
    name,
    query: {
      matchMode: draft.matchMode,
      includedCollectionIds,
      excludedCollectionIds
    }
  };
}

export function mapSavedCollectionView(row: SavedCollectionViewRow): SavedCollectionView {
  let raw: Partial<SavedCollectionViewQuery> = {};
  try {
    raw = JSON.parse(row.query_json) as Partial<SavedCollectionViewQuery>;
  } catch {
    raw = {};
  }
  const includedCollectionIds = normalizeIds(raw.includedCollectionIds, false);
  const included = new Set(includedCollectionIds);
  return {
    id: row.id,
    name: row.name,
    matchMode: normalizeMatchMode(raw.matchMode),
    includedCollectionIds,
    excludedCollectionIds: normalizeIds(raw.excludedCollectionIds, false).filter((id) => !included.has(id)),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeIds(value: unknown, strict = true): string[] {
  if (!Array.isArray(value)) {
    if (strict) throw new Error("Saved collection view conditions must be arrays");
    return [];
  }
  let input: unknown[] = value;
  if (value.length > 50) {
    if (strict) throw new Error("Saved collection view cannot reference more than 50 collections per condition");
    input = value.slice(0, 50);
  }
  const ids = input.filter(
    (item): item is string => typeof item === "string" && item.length > 0 && item.length <= 300
  );
  if (strict && ids.length !== input.length) throw new Error("Saved collection view contains an invalid collection id");
  return [...new Set(ids)];
}

function normalizeMatchMode(value: unknown): CollectionMatchMode {
  return value === "all" ? "all" : "any";
}

function translateConstraintError(error: unknown, name: string): Error {
  if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
    return new Error(`Saved collection view "${name}" already exists`);
  }
  return error instanceof Error ? error : new Error("Unable to save collection view");
}
