import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ArtworkRecord,
  AssetFileState,
  CollectionRecord,
  ElementFilterSetting,
  FilterDecision,
  ArtworkSource,
  VisionAssessment,
  WorkAssetRecord,
  WorkListItem,
  WorkOwnership,
  WorkQuery,
  WorkQueryResult,
  WorkRecord,
  WorkType
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
  cover_artwork_id: string | null;
  created_at: string;
}

interface ArtistRow {
  id: string;
  name: string;
  avatar_url: string | null;
  avatar_local_path: string | null;
  updated_at: string;
}

interface ElementFilterSettingRow {
  group_id: string;
  enabled: number;
  minimum_confidence: number;
}

interface WorkRow {
  id: string;
  source_platform: string | null;
  source_work_id: string | null;
  artist_id: string | null;
  artist_name: string | null;
  title: string;
  work_type: string;
  published_at: string | null;
  bookmarked_at: string | null;
  saved_at: string;
  last_viewed_at: string | null;
  favorite: number;
  page_count: number;
  cover_asset_id: string | null;
  ownership: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  collection_id: string | null;
}

interface WorkAssetRow {
  id: string;
  work_id: string;
  legacy_artwork_id: string | null;
  page_index: number;
  path: string;
  media_type: string;
  extension: string | null;
  width: number | null;
  height: number | null;
  byte_length: number | null;
  content_hash: string | null;
  thumbnail_path: string | null;
  file_state: string;
  created_at: string;
  updated_at: string;
}

interface WorkListRow {
  id: string;
  source_platform: string | null;
  source_work_id: string | null;
  artist_id: string | null;
  artist_name: string | null;
  title: string;
  work_type: string;
  published_at: string | null;
  saved_at: string;
  favorite: number;
  page_count: number;
  total_byte_length: number;
  ownership: string;
  collection_ids: string | null;
  cover_id: string | null;
  cover_work_id: string | null;
  cover_legacy_artwork_id: string | null;
  cover_page_index: number | null;
  cover_path: string | null;
  cover_media_type: string | null;
  cover_extension: string | null;
  cover_width: number | null;
  cover_height: number | null;
  cover_byte_length: number | null;
  cover_content_hash: string | null;
  cover_thumbnail_path: string | null;
  cover_file_state: string | null;
  cover_created_at: string | null;
  cover_updated_at: string | null;
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
  readonly #databasePath: string;

  constructor(databasePath: string) {
    this.#databasePath = databasePath;
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.#backupBeforeWorkMigration();
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

    const artworkId = existing?.id ?? (this.#database
      .prepare("SELECT id FROM artworks WHERE path = ?")
      .get(path) as { id: string }).id;
    this.#syncLegacyArtworkToWork(artworkId);

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
    this.#syncLegacyArtworkToWork(artworkId);
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

  listWorks(): WorkRecord[] {
    const rows = this.#database
      .prepare(
        `SELECT w.id, w.source_platform, w.source_work_id, w.artist_id,
                ar.name AS artist_name, w.title, w.work_type, w.published_at,
                w.bookmarked_at, w.saved_at, w.last_viewed_at, w.favorite,
                w.page_count, w.cover_asset_id, w.ownership, w.deleted_at,
                w.created_at, w.updated_at, cw.collection_id
           FROM works w
           LEFT JOIN artists ar ON ar.id = w.artist_id
           LEFT JOIN collection_works cw ON cw.work_id = w.id
          ORDER BY w.saved_at DESC, w.id`
      )
      .all() as unknown as WorkRow[];

    const assets = this.#database
      .prepare(
        `SELECT id, work_id, legacy_artwork_id, page_index, path, media_type,
                extension, width, height, byte_length, content_hash,
                thumbnail_path, file_state, created_at, updated_at
           FROM assets
          ORDER BY work_id, page_index, id`
      )
      .all() as unknown as WorkAssetRow[];
    const assetsByWork = new Map<string, WorkAssetRecord[]>();
    for (const row of assets) {
      const workAssets = assetsByWork.get(row.work_id) ?? [];
      workAssets.push(mapWorkAsset(row));
      assetsByWork.set(row.work_id, workAssets);
    }

    const byId = new Map<string, WorkRecord>();
    for (const row of rows) {
      const current = byId.get(row.id);
      if (current) {
        if (row.collection_id) current.collectionIds.push(row.collection_id);
        continue;
      }
      byId.set(row.id, {
        id: row.id,
        sourcePlatform: row.source_platform === "pixiv" ? "pixiv" : null,
        sourceWorkId: row.source_work_id,
        artistId: row.artist_id,
        artistName: row.artist_name,
        title: row.title,
        workType: asWorkType(row.work_type),
        publishedAt: row.published_at,
        bookmarkedAt: row.bookmarked_at,
        savedAt: row.saved_at,
        lastViewedAt: row.last_viewed_at,
        favorite: row.favorite === 1,
        pageCount: row.page_count,
        coverAssetId: row.cover_asset_id,
        ownership: asWorkOwnership(row.ownership),
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        collectionIds: row.collection_id ? [row.collection_id] : [],
        assets: assetsByWork.get(row.id) ?? []
      });
    }
    return [...byId.values()];
  }

  queryWorks(query: WorkQuery = {}): WorkQueryResult {
    const search = typeof query.search === "string" ? query.search.trim().slice(0, 200) : "";
    const limit = clampInteger(query.limit, 60, 1, 200);
    const offset = clampInteger(query.offset, 0, 0, 10_000_000);
    const direction = query.direction === "asc" ? "ASC" : "DESC";
    const sortExpressions: Record<NonNullable<WorkQuery["sortBy"]>, string> = {
      savedAt: "w.saved_at",
      publishedAt: "w.published_at",
      title: "w.title COLLATE NOCASE",
      artist: "ar.name COLLATE NOCASE",
      pageCount: "w.page_count",
      byteLength: "total_byte_length"
    };
    const sortExpression = sortExpressions[query.sortBy ?? "savedAt"];
    const clauses = ["w.deleted_at IS NULL"];
    const parameters: Array<string | number> = [];
    if (search) {
      clauses.push(
        `(instr(lower(w.title), lower(?)) > 0
          OR instr(lower(COALESCE(ar.name, '')), lower(?)) > 0
          OR instr(lower(COALESCE(w.source_work_id, '')), lower(?)) > 0)`
      );
      parameters.push(search, search, search);
    }
    if (isWorkType(query.workType)) {
      clauses.push("w.work_type = ?");
      parameters.push(query.workType);
    }
    if (typeof query.artistId === "string" && query.artistId) {
      clauses.push("w.artist_id = ?");
      parameters.push(query.artistId);
    }
    if (typeof query.collectionId === "string" && query.collectionId) {
      clauses.push(
        "EXISTS (SELECT 1 FROM collection_works filter_cw WHERE filter_cw.work_id = w.id AND filter_cw.collection_id = ?)"
      );
      parameters.push(query.collectionId);
    }
    const where = clauses.join(" AND ");

    const totalRow = this.#database
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(w.page_count), 0) AS total_pages
           FROM works w
           LEFT JOIN artists ar ON ar.id = w.artist_id
          WHERE ${where}`
      )
      .get(...parameters) as { total: number; total_pages: number };
    const rows = this.#database
      .prepare(
        `SELECT w.id, w.source_platform, w.source_work_id, w.artist_id,
                ar.name AS artist_name, w.title, w.work_type, w.published_at,
                w.saved_at, w.favorite, w.page_count,
                (SELECT COALESCE(SUM(a.byte_length), 0) FROM assets a WHERE a.work_id = w.id) AS total_byte_length,
                w.ownership,
                (SELECT GROUP_CONCAT(cw.collection_id, char(31)) FROM collection_works cw WHERE cw.work_id = w.id) AS collection_ids,
                ca.id AS cover_id, ca.work_id AS cover_work_id,
                ca.legacy_artwork_id AS cover_legacy_artwork_id,
                ca.page_index AS cover_page_index, ca.path AS cover_path,
                ca.media_type AS cover_media_type, ca.extension AS cover_extension,
                ca.width AS cover_width, ca.height AS cover_height,
                ca.byte_length AS cover_byte_length, ca.content_hash AS cover_content_hash,
                ca.thumbnail_path AS cover_thumbnail_path, ca.file_state AS cover_file_state,
                ca.created_at AS cover_created_at, ca.updated_at AS cover_updated_at
           FROM works w
           LEFT JOIN artists ar ON ar.id = w.artist_id
           LEFT JOIN assets ca ON ca.id = w.cover_asset_id
          WHERE ${where}
          ORDER BY (${sortExpression} IS NULL) ASC, ${sortExpression} ${direction}, w.id ASC
          LIMIT ? OFFSET ?`
      )
      .all(...parameters, limit, offset) as unknown as WorkListRow[];
    const total = Number(totalRow.total);
    return {
      items: rows.map(mapWorkListItem),
      total,
      totalPages: Number(totalRow.total_pages),
      offset,
      limit,
      hasMore: offset + rows.length < total
    };
  }

  getWork(workId: string): WorkRecord | null {
    const rows = this.#database
      .prepare(
        `SELECT w.id, w.source_platform, w.source_work_id, w.artist_id,
                ar.name AS artist_name, w.title, w.work_type, w.published_at,
                w.bookmarked_at, w.saved_at, w.last_viewed_at, w.favorite,
                w.page_count, w.cover_asset_id, w.ownership, w.deleted_at,
                w.created_at, w.updated_at, cw.collection_id
           FROM works w
           LEFT JOIN artists ar ON ar.id = w.artist_id
           LEFT JOIN collection_works cw ON cw.work_id = w.id
          WHERE w.id = ?`
      )
      .all(workId) as unknown as WorkRow[];
    const first = rows[0];
    if (!first) return null;
    const assets = this.#database
      .prepare(
        `SELECT id, work_id, legacy_artwork_id, page_index, path, media_type,
                extension, width, height, byte_length, content_hash,
                thumbnail_path, file_state, created_at, updated_at
           FROM assets WHERE work_id = ? ORDER BY page_index, id`
      )
      .all(workId) as unknown as WorkAssetRow[];
    return {
      id: first.id,
      sourcePlatform: first.source_platform === "pixiv" ? "pixiv" : null,
      sourceWorkId: first.source_work_id,
      artistId: first.artist_id,
      artistName: first.artist_name,
      title: first.title,
      workType: asWorkType(first.work_type),
      publishedAt: first.published_at,
      bookmarkedAt: first.bookmarked_at,
      savedAt: first.saved_at,
      lastViewedAt: first.last_viewed_at,
      favorite: first.favorite === 1,
      pageCount: first.page_count,
      coverAssetId: first.cover_asset_id,
      ownership: asWorkOwnership(first.ownership),
      deletedAt: first.deleted_at,
      createdAt: first.created_at,
      updatedAt: first.updated_at,
      collectionIds: rows.flatMap((row) => row.collection_id ? [row.collection_id] : []),
      assets: assets.map(mapWorkAsset)
    };
  }

  addWorkToCollection(workId: string, collectionId: string): void {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO collection_works (collection_id, work_id, added_at)
         SELECT ?, id, ? FROM works WHERE id = ?`
      )
      .run(collectionId, new Date().toISOString(), workId);
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO collection_artworks (collection_id, artwork_id)
         SELECT ?, legacy_artwork_id FROM assets
          WHERE work_id = ? AND legacy_artwork_id IS NOT NULL`
      )
      .run(collectionId, workId);
  }

  getPreference<T>(key: string): T | null {
    const row = this.#database
      .prepare("SELECT value_json FROM user_preferences WHERE key = ?")
      .get(key) as { value_json: string } | undefined;
    return row ? parseJson<T>(row.value_json) : null;
  }

  setPreference(key: string, value: unknown): void {
    this.#database
      .prepare(
        `INSERT INTO user_preferences (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  hasArtworkPath(path: string): boolean {
    return Boolean(
      this.#database.prepare("SELECT 1 AS found FROM artworks WHERE path = ?").get(path)
    );
  }

  hasAvatarPath(path: string): boolean {
    return Boolean(
      this.#database.prepare("SELECT 1 AS found FROM artists WHERE avatar_local_path = ?").get(path)
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

  updateCollectionCover(collectionId: string, artworkId: string | null): void {
    this.#database
      .prepare("UPDATE collections SET cover_artwork_id = ? WHERE id = ?")
      .run(artworkId, collectionId);
    const work = artworkId
      ? this.#database
          .prepare("SELECT work_id FROM assets WHERE legacy_artwork_id = ?")
          .get(artworkId) as { work_id: string } | undefined
      : undefined;
    this.#database
      .prepare("UPDATE collections SET cover_work_id = ? WHERE id = ?")
      .run(work?.work_id ?? null, collectionId);
  }

  listCollections(): CollectionRecord[] {
    const rows = this.#database
      .prepare("SELECT id, name, description, cover_artwork_id, created_at FROM collections ORDER BY created_at")
      .all() as unknown as CollectionRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      ...(row.cover_artwork_id ? { coverArtworkId: row.cover_artwork_id } : {}),
      createdAt: row.created_at
    }));
  }

  addArtworkToCollection(artworkId: string, collectionId: string): void {
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO collection_artworks (collection_id, artwork_id) VALUES (?, ?)"
      )
      .run(collectionId, artworkId);
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO collection_works (collection_id, work_id, added_at)
         SELECT ?, work_id, ? FROM assets WHERE legacy_artwork_id = ?`
      )
      .run(collectionId, new Date().toISOString(), artworkId);
  }

  importArtist(artist: import("@sanctuary/domain").ArtistRecord): void {
    this.#database
      .prepare(
        `INSERT INTO artists (id, name, avatar_url, avatar_local_path, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           avatar_url = excluded.avatar_url,
           avatar_local_path = excluded.avatar_local_path,
           updated_at = excluded.updated_at`
      )
      .run(
        artist.id,
        artist.name,
        artist.avatarUrl,
        artist.avatarLocalPath,
        artist.updatedAt
      );
  }

  listArtists(): import("@sanctuary/domain").ArtistRecord[] {
    const rows = this.#database
      .prepare("SELECT id, name, avatar_url, avatar_local_path, updated_at FROM artists ORDER BY updated_at DESC")
      .all() as unknown as ArtistRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      avatarUrl: row.avatar_url,
      avatarLocalPath: row.avatar_local_path,
      updatedAt: row.updated_at
    }));
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
        cover_artwork_id TEXT REFERENCES artworks(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar_url TEXT,
        avatar_local_path TEXT,
        updated_at TEXT NOT NULL
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
    this.#ensureCollectionColumns();
    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS idx_artworks_source_work
        ON artworks(source_platform, source_work_id, source_page_index);
      CREATE INDEX IF NOT EXISTS idx_artworks_author
        ON artworks(source_platform, author_id, source_work_id);
    `);
    this.#ensureWorkSchema();
    this.#migrateLegacyArtworksToWorks();
  }

  #ensureCollectionColumns(): void {
    const columns = new Set(
      (this.#database.prepare("PRAGMA table_info(collections)").all() as unknown as Array<{ name: string }>)
        .map((column) => column.name)
    );
    if (!columns.has("cover_artwork_id")) {
      this.#database.exec("ALTER TABLE collections ADD COLUMN cover_artwork_id TEXT REFERENCES artworks(id) ON DELETE SET NULL");
    }
    if (!columns.has("cover_work_id")) {
      this.#database.exec("ALTER TABLE collections ADD COLUMN cover_work_id TEXT");
    }
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

  #backupBeforeWorkMigration(): void {
    if (this.#databasePath === ":memory:" || this.#databasePath.startsWith("file:")) return;
    const hasLegacyArtworks = Boolean(
      this.#database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'artworks'")
        .get()
    );
    const hasWorks = Boolean(
      this.#database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'works'")
        .get()
    );
    if (!hasLegacyArtworks || hasWorks) return;

    const backupPath = `${this.#databasePath}.pre-v2.bak`;
    if (existsSync(backupPath)) return;
    this.#database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  }

  #ensureWorkSchema(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS works (
        id TEXT PRIMARY KEY,
        source_platform TEXT,
        source_work_id TEXT,
        artist_id TEXT REFERENCES artists(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        work_type TEXT NOT NULL CHECK (work_type IN ('illustration', 'manga', 'ugoira', 'local', 'unknown')),
        published_at TEXT,
        bookmarked_at TEXT,
        saved_at TEXT NOT NULL,
        last_viewed_at TEXT,
        favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
        page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
        cover_asset_id TEXT,
        ownership TEXT NOT NULL CHECK (ownership IN ('managed', 'external')),
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        legacy_artwork_id TEXT UNIQUE REFERENCES artworks(id) ON DELETE SET NULL,
        page_index INTEGER NOT NULL CHECK (page_index >= 0),
        path TEXT NOT NULL COLLATE NOCASE UNIQUE,
        media_type TEXT NOT NULL CHECK (media_type IN ('image', 'ugoira', 'unknown')),
        extension TEXT,
        width INTEGER,
        height INTEGER,
        byte_length INTEGER,
        content_hash TEXT,
        thumbnail_path TEXT,
        file_state TEXT NOT NULL CHECK (file_state IN ('available', 'missing', 'trashed', 'error')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (work_id, page_index)
      );

      CREATE TABLE IF NOT EXISTS collection_works (
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        added_at TEXT NOT NULL,
        PRIMARY KEY (collection_id, work_id)
      );

      CREATE TABLE IF NOT EXISTS user_preferences (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS migration_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_version INTEGER NOT NULL,
        entity_type TEXT NOT NULL,
        legacy_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        resolution TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        UNIQUE (migration_version, entity_type, legacy_id, reason)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_works_source
        ON works(source_platform, source_work_id)
        WHERE source_platform IS NOT NULL AND source_work_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_works_saved_at ON works(saved_at DESC, id);
      CREATE INDEX IF NOT EXISTS idx_works_artist ON works(artist_id, saved_at DESC);
      CREATE INDEX IF NOT EXISTS idx_assets_work ON assets(work_id, page_index);
      CREATE INDEX IF NOT EXISTS idx_collection_works_work ON collection_works(work_id);
    `);
  }

  #migrateLegacyArtworksToWorks(): void {
    const applied = this.#database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = 1")
      .get();
    if (applied) return;

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const artworkIds = this.#database
        .prepare("SELECT id FROM artworks ORDER BY imported_at, id")
        .all() as unknown as Array<{ id: string }>;
      for (const { id } of artworkIds) this.#syncLegacyArtworkToWork(id);

      this.#database.prepare(
        `INSERT OR IGNORE INTO collection_works (collection_id, work_id, added_at)
         SELECT DISTINCT ca.collection_id, a.work_id, c.created_at
           FROM collection_artworks ca
           JOIN assets a ON a.legacy_artwork_id = ca.artwork_id
           JOIN collections c ON c.id = ca.collection_id`
      ).run();
      this.#database.prepare(
        `UPDATE collections
            SET cover_work_id = (
              SELECT a.work_id FROM assets a
               WHERE a.legacy_artwork_id = collections.cover_artwork_id
            )
          WHERE cover_artwork_id IS NOT NULL`
      ).run();
      this.#database
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)")
        .run(new Date().toISOString());
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #syncLegacyArtworkToWork(artworkId: string): void {
    const row = this.#database
      .prepare(
        `SELECT id, path, file_name, imported_at, assessment_json, decision_json,
                NULL AS collection_id, source_platform, source_work_id,
                source_page_index, author_id, author_name, work_title
           FROM artworks WHERE id = ?`
      )
      .get(artworkId) as ArtworkRow | undefined;
    if (!row) throw new Error(`Legacy artwork not found: ${artworkId}`);

    const isPixiv = row.source_platform === "pixiv" && Boolean(row.source_work_id);
    const workId = isPixiv ? `pixiv:${row.source_work_id}` : `local:${row.id}`;
    const now = new Date().toISOString();
    const oldAsset = this.#database
      .prepare("SELECT id, work_id FROM assets WHERE legacy_artwork_id = ?")
      .get(row.id) as { id: string; work_id: string } | undefined;

    if (isPixiv && row.author_id && row.author_name) {
      this.#database
        .prepare(
          `INSERT INTO artists (id, name, avatar_url, avatar_local_path, updated_at)
           VALUES (?, ?, NULL, NULL, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name`
        )
        .run(row.author_id, row.author_name, now);
    }

    this.#database
      .prepare(
        `INSERT INTO works
           (id, source_platform, source_work_id, artist_id, title, work_type,
            saved_at, favorite, page_count, ownership, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           artist_id = COALESCE(excluded.artist_id, works.artist_id),
           title = CASE WHEN excluded.source_platform = 'pixiv' THEN excluded.title ELSE works.title END,
           source_platform = COALESCE(excluded.source_platform, works.source_platform),
           source_work_id = COALESCE(excluded.source_work_id, works.source_work_id),
           ownership = CASE WHEN excluded.source_platform = 'pixiv' THEN 'managed' ELSE works.ownership END,
           updated_at = excluded.updated_at`
      )
      .run(
        workId,
        isPixiv ? "pixiv" : null,
        isPixiv ? row.source_work_id : null,
        isPixiv ? row.author_id : null,
        row.work_title || row.file_name,
        isPixiv ? "unknown" : "local",
        row.imported_at,
        isPixiv ? "managed" : "external",
        row.imported_at,
        now
      );

    let pageIndex = isPixiv && row.source_page_index !== null ? row.source_page_index : 0;
    const pageCollision = this.#database
      .prepare(
        `SELECT id FROM assets
          WHERE work_id = ? AND page_index = ? AND legacy_artwork_id <> ?`
      )
      .get(workId, pageIndex, row.id) as { id: string } | undefined;
    if (pageCollision) {
      const maximum = this.#database
        .prepare("SELECT COALESCE(MAX(page_index), -1) AS maximum FROM assets WHERE work_id = ?")
        .get(workId) as { maximum: number };
      pageIndex = maximum.maximum + 1;
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO migration_conflicts
             (migration_version, entity_type, legacy_id, reason, resolution, recorded_at)
           VALUES (1, 'asset', ?, 'duplicate-page-index', ?, ?)`
        )
        .run(row.id, `assigned-page-index:${pageIndex}`, now);
    }

    this.#database
      .prepare(
        `INSERT INTO assets
           (id, work_id, legacy_artwork_id, page_index, path, media_type,
            extension, file_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'image', ?, 'available', ?, ?)
         ON CONFLICT(legacy_artwork_id) DO UPDATE SET
           work_id = excluded.work_id,
           page_index = excluded.page_index,
           path = excluded.path,
           extension = excluded.extension,
           updated_at = excluded.updated_at`
      )
      .run(
        oldAsset?.id ?? `asset:${row.id}`,
        workId,
        row.id,
        pageIndex,
        row.path,
        extname(row.path).slice(1).toLowerCase() || null,
        row.imported_at,
        now
      );

    this.#database
      .prepare(
        `INSERT OR IGNORE INTO collection_works (collection_id, work_id, added_at)
         SELECT ca.collection_id, ?, c.created_at
           FROM collection_artworks ca
           JOIN collections c ON c.id = ca.collection_id
          WHERE ca.artwork_id = ?`
      )
      .run(workId, row.id);
    this.#database
      .prepare("UPDATE collections SET cover_work_id = ? WHERE cover_artwork_id = ?")
      .run(workId, row.id);

    this.#refreshWorkAggregate(workId, now);
    if (oldAsset && oldAsset.work_id !== workId) {
      this.#refreshWorkAggregate(oldAsset.work_id, now);
      this.#database
        .prepare("DELETE FROM works WHERE id = ? AND NOT EXISTS (SELECT 1 FROM assets WHERE work_id = ?)")
        .run(oldAsset.work_id, oldAsset.work_id);
    }
  }

  #refreshWorkAggregate(workId: string, now: string): void {
    this.#database
      .prepare(
        `UPDATE works
            SET page_count = (SELECT COUNT(*) FROM assets WHERE work_id = ?),
                cover_asset_id = (
                  SELECT id FROM assets WHERE work_id = ?
                   ORDER BY page_index, id LIMIT 1
                ),
                saved_at = COALESCE((
                  SELECT MIN(aw.imported_at)
                    FROM assets a JOIN artworks aw ON aw.id = a.legacy_artwork_id
                   WHERE a.work_id = ?
                ), saved_at),
                updated_at = ?
          WHERE id = ?`
      )
      .run(workId, workId, workId, now, workId);
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

function mapWorkAsset(row: WorkAssetRow): WorkAssetRecord {
  return {
    id: row.id,
    workId: row.work_id,
    legacyArtworkId: row.legacy_artwork_id,
    pageIndex: row.page_index,
    path: row.path,
    mediaType: row.media_type === "image" || row.media_type === "ugoira"
      ? row.media_type
      : "unknown",
    extension: row.extension,
    width: row.width,
    height: row.height,
    byteLength: row.byte_length,
    contentHash: row.content_hash,
    thumbnailPath: row.thumbnail_path,
    fileState: asAssetFileState(row.file_state),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapWorkListItem(row: WorkListRow): WorkListItem {
  const coverAsset = row.cover_id && row.cover_work_id && row.cover_page_index !== null &&
      row.cover_path && row.cover_media_type && row.cover_file_state &&
      row.cover_created_at && row.cover_updated_at
    ? mapWorkAsset({
        id: row.cover_id,
        work_id: row.cover_work_id,
        legacy_artwork_id: row.cover_legacy_artwork_id,
        page_index: row.cover_page_index,
        path: row.cover_path,
        media_type: row.cover_media_type,
        extension: row.cover_extension,
        width: row.cover_width,
        height: row.cover_height,
        byte_length: row.cover_byte_length,
        content_hash: row.cover_content_hash,
        thumbnail_path: row.cover_thumbnail_path,
        file_state: row.cover_file_state,
        created_at: row.cover_created_at,
        updated_at: row.cover_updated_at
      })
    : null;
  return {
    id: row.id,
    sourcePlatform: row.source_platform === "pixiv" ? "pixiv" : null,
    sourceWorkId: row.source_work_id,
    artistId: row.artist_id,
    artistName: row.artist_name,
    title: row.title,
    workType: asWorkType(row.work_type),
    publishedAt: row.published_at,
    savedAt: row.saved_at,
    favorite: row.favorite === 1,
    pageCount: row.page_count,
    totalByteLength: Number(row.total_byte_length),
    ownership: asWorkOwnership(row.ownership),
    collectionIds: row.collection_ids ? row.collection_ids.split("\u001f") : [],
    coverAsset
  };
}

function asWorkType(value: string): WorkType {
  return value === "illustration" || value === "manga" || value === "ugoira" ||
      value === "local"
    ? value
    : "unknown";
}

function asWorkOwnership(value: string): WorkOwnership {
  return value === "managed" ? "managed" : "external";
}

function asAssetFileState(value: string): AssetFileState {
  return value === "missing" || value === "trashed" || value === "error"
    ? value
    : "available";
}

function isWorkType(value: unknown): value is WorkType {
  return value === "illustration" || value === "manga" || value === "ugoira" ||
    value === "local" || value === "unknown";
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}
