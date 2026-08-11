import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ArtworkRecord,
  CollectionRecord,
  ElementFilterSetting,
  FilterDecision,
  ArtworkSource,
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
  source_platform: string | null;
  source_work_id: string | null;
  source_page_index: number | null;
  author_id: string | null;
  author_name: string | null;
  work_title: string | null;
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

export interface RemoteImageReviewKey {
  normalizedUrl: string;
  engine: string;
  engineVersion: string;
  rulesFingerprint: string;
}

export interface RemoteImageReviewRecord extends RemoteImageReviewKey {
  contentHash: string | null;
  assessment: VisionAssessment;
  decision: FilterDecision;
  byteLength: number;
  reviewedAt: string;
}

interface RemoteImageReviewRow {
  normalized_url: string;
  content_hash: string | null;
  engine: string;
  engine_version: string;
  rules_fingerprint: string;
  assessment_json: string;
  decision_json: string;
  byte_length: number;
  reviewed_at: string;
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

  trustArtwork(artworkId: string): void {
    const decision: FilterDecision = {
      action: "allow",
      reasons: [],
      decidedAt: new Date().toISOString()
    };
    this.#database
      .prepare(
        "UPDATE artworks SET assessment_json = NULL, decision_json = ? WHERE id = ?"
      )
      .run(JSON.stringify(decision), artworkId);
  }

  saveArtworkSource(artworkId: string, source: ArtworkSource): void {
    this.#database
      .prepare(
        `UPDATE artworks
            SET source_platform = ?, source_work_id = ?, source_page_index = ?,
                author_id = ?, author_name = ?, work_title = ?
          WHERE id = ?`
      )
      .run(
        source.platform,
        source.workId,
        source.pageIndex,
        source.authorId,
        source.authorName,
        source.title,
        artworkId
      );
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
                a.assessment_json, a.decision_json, ca.collection_id,
                a.source_platform, a.source_work_id, a.source_page_index,
                a.author_id, a.author_name, a.work_title
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
        collectionIds: row.collection_id ? [row.collection_id] : [],
        source: parseArtworkSource(row)
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

  getRemoteImageReview(key: RemoteImageReviewKey): RemoteImageReviewRecord | null {
    const row = this.#database
      .prepare(
        `SELECT normalized_url, content_hash, engine, engine_version,
                rules_fingerprint, assessment_json, decision_json,
                byte_length, reviewed_at
           FROM remote_image_reviews
          WHERE normalized_url = ?
            AND engine = ?
            AND engine_version = ?
            AND rules_fingerprint = ?`
      )
      .get(
        key.normalizedUrl,
        key.engine,
        key.engineVersion,
        key.rulesFingerprint
      ) as RemoteImageReviewRow | undefined;
    if (!row) return null;

    const assessment = parseJson<VisionAssessment>(row.assessment_json);
    const decision = parseJson<FilterDecision>(row.decision_json);
    if (!assessment || assessment.status !== "complete" || !decision) return null;
    return {
      normalizedUrl: row.normalized_url,
      contentHash: row.content_hash,
      engine: row.engine,
      engineVersion: row.engine_version,
      rulesFingerprint: row.rules_fingerprint,
      assessment,
      decision,
      byteLength: row.byte_length,
      reviewedAt: row.reviewed_at
    };
  }

  saveRemoteImageReview(review: RemoteImageReviewRecord): void {
    if (review.assessment.status !== "complete") return;
    this.#database
      .prepare(
        `INSERT INTO remote_image_reviews
           (normalized_url, content_hash, engine, engine_version,
            rules_fingerprint, assessment_json, decision_json, byte_length, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(normalized_url, engine, engine_version, rules_fingerprint)
         DO UPDATE SET
           content_hash = excluded.content_hash,
           assessment_json = excluded.assessment_json,
           decision_json = excluded.decision_json,
           byte_length = excluded.byte_length,
           reviewed_at = excluded.reviewed_at`
      )
      .run(
        review.normalizedUrl,
        review.contentHash,
        review.engine,
        review.engineVersion,
        review.rulesFingerprint,
        JSON.stringify(review.assessment),
        JSON.stringify(review.decision),
        review.byteLength,
        review.reviewedAt
      );
  }

  pruneRemoteImageReviews(maxEntries = 2_000, maxAgeDays = 30): number {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1_000).toISOString();
    const expired = this.#database
      .prepare("DELETE FROM remote_image_reviews WHERE reviewed_at < ?")
      .run(cutoff);
    const overflow = this.#database
      .prepare(
        `DELETE FROM remote_image_reviews
          WHERE rowid IN (
            SELECT rowid FROM remote_image_reviews
             ORDER BY reviewed_at DESC
             LIMIT -1 OFFSET ?
          )`
      )
      .run(Math.max(0, maxEntries));
    return Number(expired.changes) + Number(overflow.changes);
  }

  countRemoteImageReviews(): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM remote_image_reviews")
      .get() as { count: number };
    return Number(row.count);
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS artworks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL COLLATE NOCASE UNIQUE,
        file_name TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        assessment_json TEXT,
        decision_json TEXT,
        source_platform TEXT,
        source_work_id TEXT,
        source_page_index INTEGER,
        author_id TEXT,
        author_name TEXT,
        work_title TEXT
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

      CREATE TABLE IF NOT EXISTS remote_image_reviews (
        normalized_url TEXT NOT NULL,
        content_hash TEXT,
        engine TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        rules_fingerprint TEXT NOT NULL,
        assessment_json TEXT NOT NULL,
        decision_json TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        reviewed_at TEXT NOT NULL,
        PRIMARY KEY (normalized_url, engine, engine_version, rules_fingerprint)
      );

      CREATE INDEX IF NOT EXISTS idx_artworks_imported_at ON artworks(imported_at DESC);
      CREATE INDEX IF NOT EXISTS idx_collection_artworks_artwork ON collection_artworks(artwork_id);
      CREATE INDEX IF NOT EXISTS idx_remote_image_reviews_reviewed_at
        ON remote_image_reviews(reviewed_at DESC);
    `);
    this.#ensureArtworkSourceColumns();
    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS idx_artworks_source_work
        ON artworks(source_platform, source_work_id, source_page_index);
      CREATE INDEX IF NOT EXISTS idx_artworks_author
        ON artworks(source_platform, author_id, source_work_id);
    `);
  }

  #ensureArtworkSourceColumns(): void {
    const columns = new Set(
      (this.#database.prepare("PRAGMA table_info(artworks)").all() as unknown as Array<{ name: string }>)
        .map((column) => column.name)
    );
    const additions: ReadonlyArray<readonly [string, string]> = [
      ["source_platform", "TEXT"],
      ["source_work_id", "TEXT"],
      ["source_page_index", "INTEGER"],
      ["author_id", "TEXT"],
      ["author_name", "TEXT"],
      ["work_title", "TEXT"]
    ];
    for (const [name, type] of additions) {
      if (!columns.has(name)) this.#database.exec(`ALTER TABLE artworks ADD COLUMN ${name} ${type}`);
    }
  }
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  return JSON.parse(value) as T;
}

function parseArtworkSource(row: ArtworkRow): ArtworkSource | null {
  if (
    row.source_platform !== "pixiv" ||
    !row.source_work_id ||
    row.source_page_index === null ||
    !row.author_id ||
    !row.author_name ||
    !row.work_title
  ) {
    return null;
  }
  return {
    platform: "pixiv",
    workId: row.source_work_id,
    pageIndex: row.source_page_index,
    authorId: row.author_id,
    authorName: row.author_name,
    title: row.work_title
  };
}
