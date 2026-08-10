import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ArtworkRecord,
  CollectionRecord,
  ElementFilterSetting,
  FilterDecision,
  VisionAssessment
} from "@sanctuary/domain";
import {
  DEFAULT_ELEMENT_FILTER_SETTINGS,
  isElementFilterSetting
} from "@sanctuary/domain";

interface ArtworkRow {
  id: string;
  path: string;
  file_name: string;
  imported_at: string;
  assessment_json: string | null;
  decision_json: string | null;
  collection_id: string | null;
}

interface CollectionRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

interface ElementFilterSettingRow {
  group_id: string;
  enabled: number;
  minimum_confidence: number;
}

export class LibraryDatabase {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  importArtwork(path: string): ArtworkRecord {
    const existing = this.#database
      .prepare("SELECT id FROM artworks WHERE path = ?")
      .get(path) as { id: string } | undefined;

    if (!existing) {
      this.#database
        .prepare(
          "INSERT INTO artworks (id, path, file_name, imported_at) VALUES (?, ?, ?, ?)"
        )
        .run(randomUUID(), path, basename(path), new Date().toISOString());
    }

    const artwork = this.listArtworks().find((item) => item.path === path);
    if (!artwork) throw new Error(`Failed to import artwork: ${path}`);
    return artwork;
  }

  saveAssessment(
    artworkId: string,
    assessment: VisionAssessment,
    decision: FilterDecision
  ): void {
    this.#database
      .prepare(
        "UPDATE artworks SET assessment_json = ?, decision_json = ? WHERE id = ?"
      )
      .run(JSON.stringify(assessment), JSON.stringify(decision), artworkId);
  }

  invalidateAssessmentsExcept(engine: string): number {
    const result = this.#database
      .prepare(
        `UPDATE artworks
            SET assessment_json = NULL, decision_json = NULL
          WHERE assessment_json IS NOT NULL
            AND json_extract(assessment_json, '$.engine') <> ?`
      )
      .run(engine);
    return Number(result.changes);
  }

  listArtworks(): ArtworkRecord[] {
    const rows = this.#database
      .prepare(
        `SELECT a.id, a.path, a.file_name, a.imported_at,
                a.assessment_json, a.decision_json, ca.collection_id
           FROM artworks a
           LEFT JOIN collection_artworks ca ON ca.artwork_id = a.id
          ORDER BY a.imported_at DESC, a.id`
      )
      .all() as unknown as ArtworkRow[];

    const byId = new Map<string, ArtworkRecord>();
    for (const row of rows) {
      const current = byId.get(row.id);
      if (current) {
        if (row.collection_id) current.collectionIds.push(row.collection_id);
        continue;
      }

      byId.set(row.id, {
        id: row.id,
        path: row.path,
        fileName: row.file_name,
        importedAt: row.imported_at,
        assessment: parseJson<VisionAssessment>(row.assessment_json),
        decision: parseJson<FilterDecision>(row.decision_json),
        collectionIds: row.collection_id ? [row.collection_id] : []
      });
    }
    return [...byId.values()];
  }

  hasArtworkPath(path: string): boolean {
    return Boolean(
      this.#database.prepare("SELECT 1 AS found FROM artworks WHERE path = ?").get(path)
    );
  }

  createCollection(name: string, description = ""): CollectionRecord {
    const collection: CollectionRecord = {
      id: randomUUID(),
      name: name.trim(),
      description: description.trim(),
      createdAt: new Date().toISOString()
    };
    if (!collection.name) throw new Error("Collection name is required");

    this.#database
      .prepare(
        "INSERT INTO collections (id, name, description, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(collection.id, collection.name, collection.description, collection.createdAt);
    return collection;
  }

  listCollections(): CollectionRecord[] {
    const rows = this.#database
      .prepare("SELECT id, name, description, created_at FROM collections ORDER BY created_at")
      .all() as unknown as CollectionRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at
    }));
  }

  addArtworkToCollection(artworkId: string, collectionId: string): void {
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO collection_artworks (collection_id, artwork_id) VALUES (?, ?)"
      )
      .run(collectionId, artworkId);
  }

  listElementFilterSettings(): ElementFilterSetting[] {
    const rows = this.#database
      .prepare(
        "SELECT group_id, enabled, minimum_confidence FROM element_filter_settings"
      )
      .all() as unknown as ElementFilterSettingRow[];
    const overrides = new Map(rows.map((row) => [row.group_id, row]));

    return DEFAULT_ELEMENT_FILTER_SETTINGS.map((defaults) => {
      const row = overrides.get(defaults.groupId);
      return row
        ? {
            groupId: defaults.groupId,
            enabled: row.enabled === 1,
            minimumConfidence: row.minimum_confidence
          }
        : { ...defaults };
    });
  }

  saveElementFilterSetting(setting: ElementFilterSetting): void {
    if (!isElementFilterSetting(setting)) throw new Error("Invalid element filter setting");
    this.#database
      .prepare(
        `INSERT INTO element_filter_settings
           (group_id, enabled, minimum_confidence, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(group_id) DO UPDATE SET
           enabled = excluded.enabled,
           minimum_confidence = excluded.minimum_confidence,
           updated_at = excluded.updated_at`
      )
      .run(
        setting.groupId,
        setting.enabled ? 1 : 0,
        setting.minimumConfidence,
        new Date().toISOString()
      );
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS artworks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL COLLATE NOCASE UNIQUE,
        file_name TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        assessment_json TEXT,
        decision_json TEXT
      );

      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS collection_artworks (
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
        PRIMARY KEY (collection_id, artwork_id)
      );

      CREATE TABLE IF NOT EXISTS element_filter_settings (
        group_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        minimum_confidence REAL NOT NULL CHECK (minimum_confidence BETWEEN 0.05 AND 0.95),
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_artworks_imported_at ON artworks(imported_at DESC);
      CREATE INDEX IF NOT EXISTS idx_collection_artworks_artwork ON collection_artworks(artwork_id);
    `);
  }
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  return JSON.parse(value) as T;
}
