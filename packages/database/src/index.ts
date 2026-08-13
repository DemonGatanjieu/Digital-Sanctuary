import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ArtworkRecord,
  AnalysisJob,
  AnalysisJobStatus,
  AnalysisScope,
  AnalysisScopePreview,
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

interface AnalysisJobRow {
  id: string;
  scope_json: string;
  status: string;
  engine: string;
  work_count: number;
  total_items: number;
  processed_items: number;
  cache_hits: number;
  error: string | null;
  cancel_requested: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface AnalysisQueueItem {
  id: string;
  jobId: string;
  workId: string;
  assetId: string;
  path: string;
  assetUpdatedAt: string;
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

  /** Creates metadata-only works for an isolated renderer benchmark database. */
  seedBenchmarkWorks(count: number): void {
    const total = clampInteger(count, 0, 0, 50_000);
    if (total === 0) return;
    const now = new Date("2026-01-01T00:00:00.000Z");
    const insertArtist = this.#database.prepare(
      `INSERT OR IGNORE INTO artists (id, name, avatar_url, avatar_local_path, updated_at)
       VALUES (?, ?, NULL, NULL, ?)`
    );
    const insertWork = this.#database.prepare(
      `INSERT OR IGNORE INTO works
         (id, source_platform, source_work_id, artist_id, title, work_type,
          published_at, saved_at, favorite, page_count, ownership, created_at, updated_at)
       VALUES (?, 'pixiv', ?, ?, ?, 'illustration', ?, ?, ?, 1, 'managed', ?, ?)`
    );
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (let index = 0; index < total; index += 1) {
        const artistIndex = index % 250;
        const artistId = `benchmark-artist-${artistIndex}`;
        const timestamp = new Date(now.getTime() + index * 60_000).toISOString();
        insertArtist.run(artistId, `Benchmark Artist ${artistIndex}`, timestamp);
        insertWork.run(
          `benchmark-work-${index}`,
          `benchmark-${index}`,
          artistId,
          `Benchmark Artwork ${String(index).padStart(5, "0")}`,
          timestamp,
          timestamp,
          index % 11 === 0 ? 1 : 0,
          timestamp,
          timestamp
        );
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
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

  listAssetsNeedingThumbnails(limit = 100): WorkAssetRecord[] {
    const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit) || 100));
    const missingRows = this.#database
      .prepare(
        `SELECT id, work_id, legacy_artwork_id, page_index, path, media_type,
                extension, width, height, byte_length, content_hash,
                thumbnail_path, file_state, created_at, updated_at
           FROM assets
          WHERE media_type = 'image'
            AND file_state = 'available'
            AND thumbnail_path IS NULL
          ORDER BY created_at, id
          LIMIT ?`
      )
      .all(safeLimit) as unknown as WorkAssetRow[];
    if (missingRows.length > 0) return missingRows.map(mapWorkAsset);

    const cachedRows = this.#database
      .prepare(
        `SELECT id, work_id, legacy_artwork_id, page_index, path, media_type,
                extension, width, height, byte_length, content_hash,
                thumbnail_path, file_state, created_at, updated_at
           FROM assets
          WHERE media_type = 'image'
            AND file_state = 'available'
            AND thumbnail_path IS NOT NULL
          ORDER BY created_at, id`
      )
      .all() as unknown as WorkAssetRow[];
    return cachedRows
      .filter((row) => !row.thumbnail_path || !existsSync(row.thumbnail_path))
      .slice(0, safeLimit)
      .map(mapWorkAsset);
  }

  updateAssetThumbnail(assetId: string, thumbnailPath: string | null): boolean {
    const normalizedPath = thumbnailPath?.trim() || null;
    const result = this.#database
      .prepare(
        `UPDATE assets
            SET thumbnail_path = ?, updated_at = ?
          WHERE id = ? AND file_state = 'available'`
      )
      .run(normalizedPath, new Date().toISOString(), assetId);
    return result.changes > 0;
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

  removeWorkFromCollection(workId: string, collectionId: string): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare("DELETE FROM collection_works WHERE collection_id = ? AND work_id = ?")
        .run(collectionId, workId);
      this.#database
        .prepare(
          `DELETE FROM collection_artworks
            WHERE collection_id = ? AND artwork_id IN (
              SELECT legacy_artwork_id FROM assets
               WHERE work_id = ? AND legacy_artwork_id IS NOT NULL
            )`
        )
        .run(collectionId, workId);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  updateWorkFavorite(workIds: readonly string[], favorite: boolean): number {
    if (workIds.length === 0) return 0;
    const statement = this.#database.prepare(
      "UPDATE works SET favorite = ?, updated_at = ? WHERE id = ?"
    );
    let changes = 0;
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const now = new Date().toISOString();
      for (const workId of workIds) {
        changes += Number(statement.run(favorite ? 1 : 0, now, workId).changes);
      }
      this.#database.exec("COMMIT");
      return changes;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  updateAssetFileState(assetId: string, state: AssetFileState): void {
    this.#database
      .prepare("UPDATE assets SET file_state = ?, updated_at = ? WHERE id = ?")
      .run(state, new Date().toISOString(), assetId);
  }

  removeWorkFromIndex(workId: string): boolean {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare("UPDATE collections SET cover_work_id = NULL WHERE cover_work_id = ?")
        .run(workId);
      this.#database
        .prepare(
          `DELETE FROM artworks WHERE id IN (
             SELECT legacy_artwork_id FROM assets
              WHERE work_id = ? AND legacy_artwork_id IS NOT NULL
           )`
        )
        .run(workId);
      const result = this.#database.prepare("DELETE FROM works WHERE id = ?").run(workId);
      this.#database.exec("COMMIT");
      return Number(result.changes) > 0;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
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

  updateCollection(collectionId: string, name: string, description = ""): CollectionRecord {
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error("Collection name is required");
    this.#database
      .prepare("UPDATE collections SET name = ?, description = ? WHERE id = ?")
      .run(normalizedName, description.trim(), collectionId);
    const collection = this.listCollections().find((item) => item.id === collectionId);
    if (!collection) throw new Error("Collection does not exist");
    return collection;
  }

  deleteCollection(collectionId: string): boolean {
    return Number(
      this.#database.prepare("DELETE FROM collections WHERE id = ?").run(collectionId).changes
    ) > 0;
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

    const defaults = DEFAULT_ELEMENT_FILTER_SETTINGS.map((defaults) => {
      const row = overrides.get(defaults.groupId);
      return row
        ? {
            groupId: defaults.groupId,
            enabled: row.enabled === 1,
            minimumConfidence: row.minimum_confidence
          }
        : { ...defaults };
    });
    const builtInIds = new Set(defaults.map((setting) => setting.groupId));
    return [
      ...defaults,
      ...rows
        .filter((row) => !builtInIds.has(row.group_id) && /^custom-[a-z0-9-]{1,64}$/.test(row.group_id))
        .map((row) => ({
          groupId: row.group_id,
          enabled: row.enabled === 1,
          minimumConfidence: row.minimum_confidence
        }))
    ];
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

  clearRemoteImageReviews(): number {
    return Number(this.#database.prepare("DELETE FROM remote_image_reviews").run().changes);
  }

  previewAnalysisScope(scope: AnalysisScope, engine: string): AnalysisScopePreview {
    const workIds = this.#workIdsForAnalysisScope(scope);
    if (workIds.length === 0) return { scope, workCount: 0, assetCount: 0, cachedAssetCount: 0 };
    const placeholders = workIds.map(() => "?").join(",");
    const row = this.#database.prepare(
      `SELECT COUNT(*) AS asset_count,
              COALESCE(SUM(CASE WHEN ar.asset_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS cached_count
         FROM assets a
         LEFT JOIN analysis_asset_results ar
           ON ar.asset_id = a.id AND ar.engine = ? AND ar.asset_updated_at = a.updated_at
        WHERE a.work_id IN (${placeholders})
          AND a.media_type = 'image' AND a.file_state = 'available'`
    ).get(engine, ...workIds) as { asset_count: number; cached_count: number };
    return {
      scope,
      workCount: workIds.length,
      assetCount: Number(row.asset_count),
      cachedAssetCount: Number(row.cached_count)
    };
  }

  createAnalysisJob(scope: AnalysisScope, engine: string): AnalysisJob {
    const workIds = this.#workIdsForAnalysisScope(scope);
    const jobId = randomUUID();
    const now = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare(
        `INSERT INTO analysis_jobs
           (id, scope_json, status, engine, work_count, total_items, processed_items,
            cache_hits, error, cancel_requested, created_at)
         VALUES (?, ?, 'queued', ?, ?, 0, 0, 0, NULL, 0, ?)`
      ).run(jobId, JSON.stringify(scope), engine, workIds.length, now);
      const insertItem = this.#database.prepare(
        `INSERT INTO analysis_job_items
           (id, job_id, work_id, asset_id, status, assessment_json, error, cached, created_at, updated_at)
         SELECT ?, ?, work_id, id, 'queued', NULL, NULL, 0, ?, ?
           FROM assets
          WHERE id = ? AND media_type = 'image' AND file_state = 'available'`
      );
      if (workIds.length > 0) {
        const placeholders = workIds.map(() => "?").join(",");
        const assets = this.#database.prepare(
          `SELECT id FROM assets WHERE work_id IN (${placeholders}) AND media_type = 'image' AND file_state = 'available' ORDER BY work_id, page_index`
        ).all(...workIds) as unknown as Array<{ id: string }>;
        for (const asset of assets) insertItem.run(randomUUID(), jobId, now, now, asset.id);
      }
      this.#database.prepare(
        "UPDATE analysis_jobs SET total_items = (SELECT COUNT(*) FROM analysis_job_items WHERE job_id = ?) WHERE id = ?"
      ).run(jobId, jobId);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.getAnalysisJob(jobId)!;
  }

  listAnalysisJobs(): AnalysisJob[] {
    const rows = this.#database.prepare("SELECT * FROM analysis_jobs ORDER BY created_at DESC LIMIT 50").all() as unknown as AnalysisJobRow[];
    return rows.map((row) => this.#mapAnalysisJob(row));
  }

  recoverInterruptedAnalysisJobs(): number {
    const now = new Date().toISOString();
    return Number(this.#database.prepare(
      `UPDATE analysis_jobs
          SET status = 'failed', error = '应用在任务完成前关闭；请新建任务后重试。', completed_at = ?
        WHERE status = 'running'`
    ).run(now).changes);
  }

  getAnalysisJob(jobId: string): AnalysisJob | null {
    const row = this.#database.prepare("SELECT * FROM analysis_jobs WHERE id = ?").get(jobId) as AnalysisJobRow | undefined;
    return row ? this.#mapAnalysisJob(row) : null;
  }

  startAnalysisJob(jobId: string): boolean {
    return Number(this.#database.prepare(
      "UPDATE analysis_jobs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ? AND status = 'queued'"
    ).run(new Date().toISOString(), jobId).changes) > 0;
  }

  requestAnalysisCancellation(jobId: string): boolean {
    const now = new Date().toISOString();
    const queued = this.#database.prepare(
      "UPDATE analysis_jobs SET status = 'cancelled', cancel_requested = 1, completed_at = ? WHERE id = ? AND status = 'queued'"
    ).run(now, jobId);
    if (queued.changes > 0) return true;
    return Number(this.#database.prepare(
      "UPDATE analysis_jobs SET cancel_requested = 1 WHERE id = ? AND status = 'running'"
    ).run(jobId).changes) > 0;
  }

  isAnalysisCancellationRequested(jobId: string): boolean {
    const row = this.#database.prepare("SELECT cancel_requested FROM analysis_jobs WHERE id = ?").get(jobId) as { cancel_requested: number } | undefined;
    return row?.cancel_requested === 1;
  }

  claimNextAnalysisItem(jobId: string): AnalysisQueueItem | null {
    const row = this.#database.prepare(
      `SELECT ji.id, ji.job_id, ji.work_id, ji.asset_id, a.path, a.updated_at
         FROM analysis_job_items ji JOIN assets a ON a.id = ji.asset_id
        WHERE ji.job_id = ? AND ji.status = 'queued'
        ORDER BY ji.created_at, ji.id LIMIT 1`
    ).get(jobId) as { id: string; job_id: string; work_id: string; asset_id: string; path: string; updated_at: string } | undefined;
    if (!row) return null;
    this.#database.prepare("UPDATE analysis_job_items SET status = 'running', updated_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    return { id: row.id, jobId: row.job_id, workId: row.work_id, assetId: row.asset_id, path: row.path, assetUpdatedAt: row.updated_at };
  }

  getCachedAssetAnalysis(assetId: string, assetUpdatedAt: string, engine: string): VisionAssessment | null {
    const row = this.#database.prepare(
      "SELECT assessment_json FROM analysis_asset_results WHERE asset_id = ? AND asset_updated_at = ? AND engine = ?"
    ).get(assetId, assetUpdatedAt, engine) as { assessment_json: string } | undefined;
    return row ? parseJson<VisionAssessment>(row.assessment_json) : null;
  }

  completeAnalysisItem(item: AnalysisQueueItem, assessment: VisionAssessment, cached: boolean): void {
    const now = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare(
        "UPDATE analysis_job_items SET status = 'complete', assessment_json = ?, error = NULL, cached = ?, updated_at = ? WHERE id = ?"
      ).run(JSON.stringify(assessment), cached ? 1 : 0, now, item.id);
      if (!cached && assessment.status === "complete") {
        this.#database.prepare(
          `INSERT INTO analysis_asset_results
             (asset_id, asset_updated_at, engine, engine_version, assessment_json, analyzed_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(asset_id, engine) DO UPDATE SET
             asset_updated_at = excluded.asset_updated_at,
             engine_version = excluded.engine_version,
             assessment_json = excluded.assessment_json,
             analyzed_at = excluded.analyzed_at`
        ).run(item.assetId, item.assetUpdatedAt, assessment.engine, assessment.engineVersion, JSON.stringify(assessment), now);
      }
      this.#database.prepare(
        "UPDATE analysis_jobs SET processed_items = processed_items + 1, cache_hits = cache_hits + ? WHERE id = ?"
      ).run(cached ? 1 : 0, item.jobId);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  failAnalysisItem(item: AnalysisQueueItem, error: string): void {
    const now = new Date().toISOString();
    this.#database.prepare(
      "UPDATE analysis_job_items SET status = 'error', error = ?, updated_at = ? WHERE id = ?"
    ).run(error.slice(0, 500), now, item.id);
    this.#database.prepare("UPDATE analysis_jobs SET processed_items = processed_items + 1 WHERE id = ?").run(item.jobId);
  }

  finishAnalysisJob(jobId: string, status: Extract<AnalysisJobStatus, "completed" | "cancelled" | "failed">, error: string | null = null): void {
    this.#database.prepare(
      "UPDATE analysis_jobs SET status = ?, error = ?, completed_at = ? WHERE id = ?"
    ).run(status, error?.slice(0, 500) ?? null, new Date().toISOString(), jobId);
  }

  #workIdsForAnalysisScope(scope: AnalysisScope): string[] {
    if (scope.type === "all") {
      return (this.#database.prepare("SELECT id FROM works WHERE deleted_at IS NULL ORDER BY saved_at DESC").all() as unknown as Array<{ id: string }>).map((row) => row.id);
    }
    if (scope.type === "artist") {
      return (this.#database.prepare("SELECT id FROM works WHERE artist_id = ? AND deleted_at IS NULL ORDER BY saved_at DESC").all(scope.artistId) as unknown as Array<{ id: string }>).map((row) => row.id);
    }
    if (scope.type === "collection") {
      return (this.#database.prepare(
        `SELECT w.id FROM works w JOIN collection_works cw ON cw.work_id = w.id
          WHERE cw.collection_id = ? AND w.deleted_at IS NULL ORDER BY w.saved_at DESC`
      ).all(scope.collectionId) as unknown as Array<{ id: string }>).map((row) => row.id);
    }
    const uniqueIds = [...new Set(scope.workIds)];
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => "?").join(",");
    return (this.#database.prepare(
      `SELECT id FROM works WHERE deleted_at IS NULL AND id IN (${placeholders})`
    ).all(...uniqueIds) as unknown as Array<{ id: string }>).map((row) => row.id);
  }

  #mapAnalysisJob(row: AnalysisJobRow): AnalysisJob {
    const labelWorks = new Map<string, Map<string, number>>();
    const ignored = new Set(["general", "sensitive", "questionable", "explicit", "safe", "rating:safe", "rating:questionable", "rating:explicit"]);
    const items = this.#database.prepare(
      "SELECT work_id, assessment_json FROM analysis_job_items WHERE job_id = ? AND status = 'complete' AND assessment_json IS NOT NULL"
    ).all(row.id) as unknown as Array<{ work_id: string; assessment_json: string }>;
    const failedRow = this.#database.prepare(
      "SELECT COUNT(*) AS count FROM analysis_job_items WHERE job_id = ? AND status = 'error'"
    ).get(row.id) as { count: number };
    for (const item of items) {
      const assessment = parseJson<VisionAssessment>(item.assessment_json);
      if (!assessment || assessment.status !== "complete") continue;
      const topLabels = Object.entries(assessment.labels)
        .filter(([label, confidence]) => !ignored.has(label) && confidence >= 0.55)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3);
      for (const [label, confidence] of topLabels) {
        const workScores = labelWorks.get(label) ?? new Map<string, number>();
        workScores.set(item.work_id, Math.max(workScores.get(item.work_id) ?? 0, confidence));
        labelWorks.set(label, workScores);
      }
    }
    const suggestions = [...labelWorks.entries()]
      .map(([label, workScores]) => ({
        id: `label:${label}`,
        label,
        averageConfidence: [...workScores.values()].reduce((sum, value) => sum + value, 0) / workScores.size,
        workIds: [...workScores.keys()]
      }))
      .sort((left, right) => right.workIds.length - left.workIds.length || right.averageConfidence - left.averageConfidence)
      .slice(0, 12);
    return {
      id: row.id,
      scope: parseJson<AnalysisScope>(row.scope_json) ?? { type: "all" },
      status: row.status as AnalysisJobStatus,
      engine: row.engine,
      workCount: Number(row.work_count),
      totalItems: Number(row.total_items),
      processedItems: Number(row.processed_items),
      failedItems: Number(failedRow.count),
      cacheHits: Number(row.cache_hits),
      error: row.error,
      cancelRequested: row.cancel_requested === 1,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      suggestions
    };
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

      CREATE TABLE IF NOT EXISTS analysis_jobs (
        id TEXT PRIMARY KEY,
        scope_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed')),
        engine TEXT NOT NULL,
        work_count INTEGER NOT NULL,
        total_items INTEGER NOT NULL,
        processed_items INTEGER NOT NULL,
        cache_hits INTEGER NOT NULL,
        error TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS analysis_asset_results (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        asset_updated_at TEXT NOT NULL,
        engine TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        assessment_json TEXT NOT NULL,
        analyzed_at TEXT NOT NULL,
        PRIMARY KEY (asset_id, engine)
      );

      CREATE TABLE IF NOT EXISTS analysis_job_items (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
        work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'error')),
        assessment_json TEXT,
        error TEXT,
        cached INTEGER NOT NULL DEFAULT 0 CHECK (cached IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (job_id, asset_id)
      );

      CREATE INDEX IF NOT EXISTS idx_analysis_job_items_queue
        ON analysis_job_items(job_id, status, created_at);

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
    const fileStat = existsSync(row.path) ? statSync(row.path) : null;

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
            extension, byte_length, file_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'image', ?, ?, ?, ?, ?)
         ON CONFLICT(legacy_artwork_id) DO UPDATE SET
           work_id = excluded.work_id,
           page_index = excluded.page_index,
           path = excluded.path,
           extension = excluded.extension,
           byte_length = excluded.byte_length,
           file_state = excluded.file_state,
           updated_at = excluded.updated_at`
      )
      .run(
        oldAsset?.id ?? `asset:${row.id}`,
        workId,
        row.id,
        pageIndex,
        row.path,
        extname(row.path).slice(1).toLowerCase() || null,
        fileStat?.size ?? null,
        fileStat ? "available" : "missing",
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
