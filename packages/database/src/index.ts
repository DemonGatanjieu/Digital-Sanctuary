import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ArtworkRecord,
  AnalysisJob,
  AnalysisTaskSummary,
  AnalysisJobStatus,
  AnalysisScope,
  AnalysisScopePreview,
  AssetFileState,
  CollectionMatchMode,
  CollectionRecord,
  ElementFilterSetting,
  FilterDecision,
  FilterRule,
  ArtworkSource,
  SavedCollectionView,
  SavedCollectionViewDraft,
  StorageMigrationResult,
  VisionAssessment,
  WorkAssetRecord,
  WorkListItem,
  WorkOwnership,
  WorkQuery,
  WorkQueryResult,
  WorkRecord,
  WorkReadingProgress,
  WorkType,
  VisionEvaluationResult,
  VisionEvaluationKind,
  VisionEvaluationStatus,
  VisionEvaluationScope,
  VisionDimensionScore,
  TriageQueryResultItem,
  ComfyUiJob,
  ComfyUiJobStatus,
  GenerationProvenance,
  ArtistSummary,
  CollectionSummary,
  GalleryScope,
  ScopedArtworkRecord,
  DirectoryPageQuery,
  SavedViewSummaryResult,
  ArtworkPageQuery,
  ArtworkPageQueryResult
} from "@sanctuary/domain";
import { SavedCollectionViewStore } from "./saved-collection-view-store.js";
import { LibraryDirectoryStore } from "./library-directory-store.js";
import { WorkNameStore } from "./work-name-store.js";
import {
  DEFAULT_ELEMENT_FILTER_SETTINGS,
  getVisionSuite,
  isElementFilterSetting
} from "@sanctuary/domain";

function analysisScopePredicate(scope: AnalysisScope): { sql: string; params: string[] } {
  const alive = "w.deleted_at IS NULL";
  if (scope.type === "selected") return { sql: scope.workIds.length ? `${alive} AND w.id IN (${scope.workIds.map(() => "?").join(",")})` : "0", params: scope.workIds };
  if (scope.type === "artist") return { sql: `${alive} AND w.artist_id = ?`, params: [scope.artistId] };
  if (scope.type === "collection") return { sql: `${alive} AND EXISTS (SELECT 1 FROM collection_works cw WHERE cw.work_id = w.id AND cw.collection_id = ?)`, params: [scope.collectionId] };
  return { sql: alive, params: [] };
}

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
  display_name?: string | null;
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
  last_viewed_at: string | null;
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

interface VisionEvaluationResultRow {
  id: string;
  work_id: string;
  asset_id: string;
  scope: string;
  kind: string;
  suite_id: string;
  suite_version: number;
  status: string;
  reason_code: string | null;
  reading_json: string | null;
  summary: string | null;
  provider_id: string | null;
  model_id: string | null;
  evaluator_version: string;
  prompt_version: string | null;
  preprocessing_fingerprint: string;
  asset_version: string;
  created_at: string;
  updated_at: string;
}

interface VisionDimensionScoreRow {
  result_id: string;
  dimension_key: string;
  label: string;
  score: number;
  explanation: string | null;
}

interface ComfyUiJobRow {
  id: string;
  status: string;
  source_work_id: string;
  source_asset_id: string;
  template_id: string;
  template_name: string;
  positive_prompt: string;
  negative_prompt: string;
  remote_prompt_id: string | null;
  output_work_id: string | null;
  workflow_summary_json: string;
  parameters_json: string;
  error: string | null;
  cancel_requested: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface GenerationProvenanceRow {
  output_work_id: string;
  source_work_id: string;
  source_asset_id: string;
  provider: string;
  template_name: string;
  positive_prompt: string;
  negative_prompt: string;
  workflow_summary_json: string;
  parameters_json: string;
  created_at: string;
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
  readonly #savedCollectionViews: SavedCollectionViewStore;
  readonly #directory: LibraryDirectoryStore;
  readonly #workNames: WorkNameStore;

  constructor(databasePath: string) {
    this.#databasePath = databasePath;
    this.#database = new DatabaseSync(databasePath);
    this.#savedCollectionViews = new SavedCollectionViewStore(this.#database);
    this.#directory = new LibraryDirectoryStore(this.#database, (query) => this.#queryWorkPage(query));
    this.#workNames = new WorkNameStore(this.#database);
    this.#database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.#backupBeforeWorkMigration();
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  schemaVersion(): number {
    const row = this.#database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
    return Number(row.version);
  }

  renameWork(workId: string, name: string): WorkRecord {
    this.#workNames.rename(workId, name);
    return this.getWork(workId)!;
  }

  backupTo(destinationPath: string): string {
    if (this.#databasePath === ":memory:" || this.#databasePath.startsWith("file:")) throw new Error("In-memory databases cannot be backed up");
    if (!destinationPath.trim()) throw new Error("Backup destination is required");
    this.#database.exec(`VACUUM INTO '${destinationPath.replaceAll("'", "''")}'`);
    return destinationPath;
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

    const rows = this.#database.prepare(
      `SELECT a.id, a.path, a.file_name, a.imported_at,
              a.assessment_json, a.decision_json, ca.collection_id,
              a.source_platform, a.source_work_id, a.source_page_index,
              a.author_id, a.author_name, a.work_title, w.custom_title AS display_name
         FROM artworks a
         LEFT JOIN assets asset ON asset.legacy_artwork_id = a.id
         LEFT JOIN works w ON w.id = asset.work_id
         LEFT JOIN collection_artworks ca ON ca.artwork_id = a.id
        WHERE a.id = ?`
    ).all(artworkId) as unknown as ArtworkRow[];
    const artwork = mapArtworkRows(rows)[0];
    if (!artwork) throw new Error(`Failed to import artwork: ${path}`);
    return artwork;
  }

  findLocalImportMatch(path: string, contentHash?: string, ownership?: "managed" | "external"): { artworkId: string; path: string } | null {
    const row = this.#database.prepare(
      `SELECT a.legacy_artwork_id AS artworkId, a.path FROM assets a
       JOIN works w ON w.id = a.work_id
       WHERE a.legacy_artwork_id IS NOT NULL AND w.deleted_at IS NULL
         AND (? IS NULL OR w.ownership = ?)
         AND (a.path = ? COLLATE NOCASE OR (? IS NOT NULL AND a.content_hash = ? AND a.file_state = 'available'))
       ORDER BY CASE WHEN a.path = ? COLLATE NOCASE THEN 0 ELSE 1 END LIMIT 1`
    ).get(ownership ?? null, ownership ?? null, path, contentHash ?? null, contentHash ?? null, path) as { artworkId: string; path: string } | undefined;
    return row ?? null;
  }

  workIdForArtwork(id: string): string | null {
    return (this.#database.prepare("SELECT work_id FROM assets WHERE legacy_artwork_id = ?").get(id) as { work_id: string } | undefined)?.work_id ?? null;
  }

  /** One indexed image and its album membership commit together; existing analysis survives reuse. */
  commitLocalImport(path: string, contentHash: string, collectionId: string | null, reuseId?: string, ownership?: "managed" | "external", webSource?: {pageUrl:string;imageUrl:string;title:string;savedAt:string}): string {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      if (collectionId && !this.#database.prepare("SELECT id FROM collections WHERE id = ?").get(collectionId)) {
        throw new Error("相册已不存在，请重新选择相册");
      }
      const existing = this.findLocalImportMatch(path);
      const id = reuseId ?? existing?.artworkId ?? this.importArtwork(path).id;
      const asset = this.#database.prepare("SELECT work_id, content_hash FROM assets WHERE legacy_artwork_id = ?")
        .get(id) as { work_id: string; content_hash: string | null } | undefined;
      if (!asset) throw new Error("图片已从图库移除，请重新选择后导入");
      if (!reuseId && !existing) this.trustArtwork(id);
      if (!reuseId || path.toLowerCase() === existing?.path.toLowerCase()) {
        this.#database.prepare("UPDATE assets SET content_hash = ?, byte_length = ?, file_state = 'available', thumbnail_path = CASE WHEN content_hash IS NOT NULL AND content_hash != ? THEN NULL ELSE thumbnail_path END, updated_at = ? WHERE legacy_artwork_id = ?")
          .run(contentHash, statSync(path).size, contentHash, new Date().toISOString(), id);
        if (asset.content_hash && asset.content_hash !== contentHash) {
          this.#database.prepare("UPDATE artworks SET assessment_json = NULL, decision_json = NULL WHERE id = ?").run(id);
        }
        this.#database.prepare("UPDATE works SET deleted_at = NULL WHERE id = ?").run(asset.work_id);
      }
      if (collectionId) this.addArtworkToCollection(id, collectionId);
      if (ownership === "managed") this.#database.prepare("UPDATE works SET ownership = 'managed' WHERE id = ?").run(asset.work_id);
      if (webSource && !reuseId) {
        this.setPreference(`web-source:${asset.work_id}`, webSource);
        const title = webSource.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0,200);
        if (title) this.renameWork(asset.work_id, title);
      }
      this.#database.exec("COMMIT");
      return id;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Relinking keeps the asset identity, names, albums and analysis. Caller verifies content first. */
  relinkExternalAsset(workId: string, assetId: string, path: string, hash: string): WorkRecord {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const work = this.getWork(workId);
      const asset = work?.assets.find((item) => item.id === assetId);
      if (!work || work.ownership !== "external" || !asset?.legacyArtworkId) throw new Error("只能重新定位外部图片");
      const conflict = this.findLocalImportMatch(path);
      if (conflict && conflict.artworkId !== asset.legacyArtworkId) throw new Error("这个文件已属于图库中的另一张图片，请选择原图片");
      if (asset.contentHash && asset.contentHash !== hash) throw new Error("所选文件与原图片内容不同，请选择原图片");
      if (!asset.contentHash) {
        this.#database.prepare("UPDATE assets SET thumbnail_path = NULL WHERE id = ?").run(assetId);
        this.#database.prepare("UPDATE artworks SET assessment_json = NULL, decision_json = NULL WHERE id = ?").run(asset.legacyArtworkId);
        this.#database.prepare("DELETE FROM analysis_asset_results WHERE asset_id = ?").run(assetId);
        this.#database.prepare("DELETE FROM vision_evaluation_results WHERE asset_id = ?").run(assetId);
      }
      this.#database.prepare("UPDATE artworks SET path = ?, file_name = ? WHERE id = ?").run(path, basename(path), asset.legacyArtworkId);
      this.#database.prepare("UPDATE assets SET path = ?, content_hash = ?, byte_length = ?, extension = ?, file_state = 'available', updated_at = ? WHERE id = ?")
        .run(path, hash, statSync(path).size, extname(path).slice(1).toLowerCase(), new Date().toISOString(), assetId);
      this.#database.exec("COMMIT");
      return this.getWork(workId)!;
    } catch (error) { this.#database.exec("ROLLBACK"); throw error; }
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
                a.author_id, a.author_name, a.work_title, w.custom_title AS display_name
           FROM artworks a
           LEFT JOIN assets asset ON asset.legacy_artwork_id = a.id
           LEFT JOIN works w ON w.id = asset.work_id
           LEFT JOIN collection_artworks ca ON ca.artwork_id = a.id
          ORDER BY a.imported_at DESC, a.id`
      )
      .all() as unknown as ArtworkRow[];

    return mapArtworkRows(rows);
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
    return this.#queryWorkPage(query);
  }

  matchingWorkIds(ids: string[], query: WorkQuery): Set<string> {
    if(!ids.length)return new Set();
    const predicate=workQueryPredicate(query),unique=[...new Set(ids)].slice(0,10000);
    const rows=this.#database.prepare(`SELECT w.id FROM works w LEFT JOIN artists ar ON ar.id=w.artist_id
      WHERE ${predicate.sql} AND w.id IN (${unique.map(()=>"?").join(",")})`).all(...predicate.params,...unique) as Array<{id:string}>;
    return new Set(rows.map(row=>row.id));
  }

  queryWorkIds(ids: string[]): WorkListItem[] {
    return this.#queryWorkPage({ limit: 200 }, [...new Set(ids)].slice(0, 200)).items;
  }

  #queryWorkPage(query: WorkQuery, ids?: string[]): WorkQueryResult {
    let whereIds = "";
    const search = typeof query.search === "string" ? query.search.trim().slice(0, 200) : "";
    const limit = clampInteger(query.limit, 60, 1, 200);
    const offset = clampInteger(query.offset, 0, 0, 10_000_000);
    const direction = query.direction === "asc" ? "ASC" : "DESC";
    const sortBy = query.sortBy ?? "savedAt";
    const sortExpressions: Record<NonNullable<WorkQuery["sortBy"]>, string> = {
      savedAt: "w.saved_at",
      lastViewedAt: "w.last_viewed_at",
      publishedAt: "w.published_at",
      title: "w.title COLLATE NOCASE",
      artist: "ar.name COLLATE NOCASE",
      pageCount: "w.page_count",
      byteLength: "(SELECT COALESCE(SUM(a.byte_length), 0) FROM assets a WHERE a.work_id = w.id)"
    };
    const sortExpression = sortExpressions[sortBy];
    const nullableSort = sortBy === "publishedAt" || sortBy === "artist" || (sortBy === "lastViewedAt" && query.viewedOnly !== true);
    const pageSort = `sort_value ${direction}, w.id ASC`;
    const resultSort = `page.sort_value${sortBy === "title" || sortBy === "artist" ? " COLLATE NOCASE" : ""} ${direction}, w.id ASC`;
    const { sql: where, params: parameters } = workQueryPredicate(query);
    if (ids) {
      if (!ids.length) return { items: [], total: 0, totalPages: 0, offset, limit, hasMore: false };
      whereIds = ` AND w.id IN (${ids.map(() => "?").join(",")})`;
      parameters.push(...ids);
    }

    const totalRow = this.#database
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(w.page_count), 0) AS total_pages
           FROM works w
           ${search ? "LEFT JOIN artists ar ON ar.id = w.artist_id" : ""}
          WHERE ${where}${whereIds}`
      )
      .get(...parameters) as { total: number; total_pages: number };
    const rows = this.#database
      .prepare(
        `WITH page AS MATERIALIZED (
           SELECT w.id, ${sortExpression} AS sort_value
             FROM works w
             LEFT JOIN artists ar ON ar.id = w.artist_id
            WHERE ${where}${whereIds}
            ORDER BY ${nullableSort ? "(sort_value IS NULL) ASC, " : ""}${pageSort}
            LIMIT ? OFFSET ?
         )
         SELECT w.id, w.source_platform, w.source_work_id, w.artist_id,
                ar.name AS artist_name, w.title, w.work_type, w.published_at,
                w.saved_at, w.last_viewed_at, w.favorite, w.page_count,
                ${sortBy === "byteLength" ? "page.sort_value" : "(SELECT COALESCE(SUM(a.byte_length), 0) FROM assets a WHERE a.work_id = w.id)"} AS total_byte_length,
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
           FROM page
           JOIN works w ON w.id = page.id
           LEFT JOIN artists ar ON ar.id = w.artist_id
           LEFT JOIN assets ca ON ca.id = w.cover_asset_id
          ORDER BY ${nullableSort ? "(page.sort_value IS NULL) ASC, " : ""}${resultSort}`
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
          WHERE w.id = ? AND w.deleted_at IS NULL`
      )
      .all(workId) as unknown as WorkRow[];
    const first = rows[0];
    const readingProgress = this.#readReadingProgress().find((entry) => entry.workId === workId);
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
      assets: assets.map(mapWorkAsset),
      ...(readingProgress ? { readingProgress } : {})
    };
  }

  recordWorkView(workId: string, assetId: string): WorkReadingProgress | null {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const target = this.#database.prepare(
        `SELECT 1 AS found FROM assets a JOIN works w ON w.id = a.work_id
          WHERE w.id = ? AND a.id = ? AND w.deleted_at IS NULL
            AND a.media_type = 'image' AND a.file_state = 'available'`
      ).get(workId, assetId);
      if (!target) {
        this.#database.exec("COMMIT");
        return null;
      }
      const progress: WorkReadingProgress = { workId, assetId, viewedAt: new Date().toISOString() };
      const history = this.#readReadingProgress().filter((entry) => entry.workId !== workId);
      this.#database.prepare("UPDATE works SET last_viewed_at = ? WHERE id = ?").run(progress.viewedAt, workId);
      this.setPreference("library.readingProgress", [progress, ...history].slice(0, 100));
      this.#database.exec("COMMIT");
      return progress;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #readReadingProgress(): WorkReadingProgress[] {
    const row = this.#database.prepare("SELECT value_json FROM user_preferences WHERE key = ?")
      .get("library.readingProgress") as { value_json: string } | undefined;
    if (!row) return [];
    let stored: unknown;
    try { stored = JSON.parse(row.value_json); } catch { stored = []; }
    const candidates = (Array.isArray(stored) ? stored.slice(0, 100) : []).flatMap((value: unknown): WorkReadingProgress[] => {
      if (!value || typeof value !== "object") return [];
      const entry = value as Partial<WorkReadingProgress>;
      const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,299}$/.test(id);
      if (!validId(entry.workId) || !validId(entry.assetId) || typeof entry.viewedAt !== "string" || entry.viewedAt.length > 40) return [];
      const time = Date.parse(entry.viewedAt);
      if (!Number.isFinite(time) || new Date(time).toISOString() !== entry.viewedAt) return [];
      return [{ workId: entry.workId, assetId: entry.assetId, viewedAt: entry.viewedAt }];
    }).sort((left, right) => right.viewedAt.localeCompare(left.viewedAt));
    const ids = [...new Set(candidates.map((entry) => entry.assetId))];
    const validAssets = new Map<string, string>();
    if (ids.length > 0) {
      const rows = this.#database.prepare(
        `SELECT a.id, a.work_id FROM assets a JOIN works w ON w.id = a.work_id
          WHERE a.id IN (${ids.map(() => "?").join(", ")}) AND w.deleted_at IS NULL
            AND a.media_type = 'image' AND a.file_state = 'available'`
      ).all(...ids) as Array<{ id: string; work_id: string }>;
      for (const asset of rows) validAssets.set(asset.id, asset.work_id);
    }
    const seen = new Set<string>();
    const history = candidates.filter((entry) => {
      if (seen.has(entry.workId) || validAssets.get(entry.assetId) !== entry.workId) return false;
      seen.add(entry.workId);
      return true;
    });
    if (row.value_json !== JSON.stringify(history)) this.setPreference("library.readingProgress", history);
    return history;
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
      .iterate() as unknown as Iterable<WorkAssetRow>;
    const missingAssets: WorkAssetRecord[] = [];
    for (const row of cachedRows) {
      if (row.thumbnail_path && existsSync(row.thumbnail_path)) continue;
      missingAssets.push(mapWorkAsset(row));
      if (missingAssets.length >= safeLimit) break;
    }
    return missingAssets;
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
    if (state !== "available") this.#readReadingProgress();
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
      this.#readReadingProgress();
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

  createComfyUiJob(input: {
    sourceWorkId: string;
    sourceAssetId: string;
    templateId: string;
    templateName: string;
    positivePrompt: string;
    negativePrompt: string;
    workflowSummary: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  }): ComfyUiJob {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.#database.prepare(
      `INSERT INTO comfyui_jobs
         (id, status, source_work_id, source_asset_id, template_id, template_name,
          positive_prompt, negative_prompt, workflow_summary_json, parameters_json,
          cancel_requested, created_at)
       VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      id,
      input.sourceWorkId,
      input.sourceAssetId,
      input.templateId,
      input.templateName,
      input.positivePrompt,
      input.negativePrompt,
      JSON.stringify(input.workflowSummary),
      JSON.stringify(input.parameters ?? {}),
      now
    );
    return this.getComfyUiJob(id)!;
  }

  getComfyUiJob(jobId: string): ComfyUiJob | null {
    const row = this.#database.prepare("SELECT * FROM comfyui_jobs WHERE id = ?").get(jobId) as unknown as ComfyUiJobRow | undefined;
    return row ? mapComfyUiJob(row) : null;
  }

  listComfyUiJobs(limit = 30): ComfyUiJob[] {
    const safeLimit = clampInteger(limit, 30, 1, 100);
    return (this.#database.prepare("SELECT * FROM comfyui_jobs ORDER BY created_at DESC LIMIT ?").all(safeLimit) as unknown as ComfyUiJobRow[])
      .map(mapComfyUiJob);
  }

  startComfyUiJob(jobId: string): boolean {
    const result = this.#database.prepare(
      "UPDATE comfyui_jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'"
    ).run(new Date().toISOString(), jobId);
    return Number(result.changes) === 1;
  }

  setComfyUiRemotePrompt(jobId: string, promptId: string): void {
    this.#database.prepare("UPDATE comfyui_jobs SET remote_prompt_id = ? WHERE id = ? AND status = 'running'").run(promptId, jobId);
  }

  requestComfyUiJobCancellation(jobId: string): boolean {
    const now = new Date().toISOString();
    const queued = this.#database.prepare(
      "UPDATE comfyui_jobs SET status = 'cancelled', cancel_requested = 1, completed_at = ? WHERE id = ? AND status = 'queued'"
    ).run(now, jobId);
    if (Number(queued.changes) === 1) return true;
    const running = this.#database.prepare(
      "UPDATE comfyui_jobs SET cancel_requested = 1 WHERE id = ? AND status = 'running'"
    ).run(jobId);
    return Number(running.changes) === 1;
  }

  isComfyUiJobCancellationRequested(jobId: string): boolean {
    const row = this.#database.prepare("SELECT cancel_requested FROM comfyui_jobs WHERE id = ?").get(jobId) as { cancel_requested: number } | undefined;
    return row?.cancel_requested === 1;
  }

  finishComfyUiJob(jobId: string, status: "completed" | "failed" | "cancelled", outputWorkId: string | null, error: string | null): void {
    this.#database.prepare(
      "UPDATE comfyui_jobs SET status = ?, output_work_id = ?, error = ?, completed_at = ? WHERE id = ?"
    ).run(status, outputWorkId, error, new Date().toISOString(), jobId);
  }

  recoverInterruptedComfyUiJobs(): number {
    const result = this.#database.prepare(
      "UPDATE comfyui_jobs SET status = 'failed', error = '应用在任务完成前退出', completed_at = ? WHERE status = 'running'"
    ).run(new Date().toISOString());
    return Number(result.changes);
  }

  saveGenerationProvenance(value: GenerationProvenance): void {
    this.#database.prepare(
      `INSERT INTO generation_provenance
         (output_work_id, source_work_id, source_asset_id, provider, template_name,
          positive_prompt, negative_prompt, workflow_summary_json, parameters_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(output_work_id) DO UPDATE SET
         source_work_id = excluded.source_work_id,
         source_asset_id = excluded.source_asset_id,
         provider = excluded.provider,
         template_name = excluded.template_name,
         positive_prompt = excluded.positive_prompt,
         negative_prompt = excluded.negative_prompt,
         workflow_summary_json = excluded.workflow_summary_json,
         parameters_json = excluded.parameters_json`
    ).run(
      value.outputWorkId,
      value.sourceWorkId,
      value.sourceAssetId,
      value.provider,
      value.templateName,
      value.positivePrompt,
      value.negativePrompt,
      JSON.stringify(value.workflowSummary),
      JSON.stringify(value.parameters),
      value.createdAt
    );
  }

  getGenerationProvenance(outputWorkId: string): GenerationProvenance | null {
    const row = this.#database.prepare("SELECT * FROM generation_provenance WHERE output_work_id = ?").get(outputWorkId) as unknown as GenerationProvenanceRow | undefined;
    if (!row) return null;
    return {
      outputWorkId: row.output_work_id,
      sourceWorkId: row.source_work_id,
      sourceAssetId: row.source_asset_id,
      provider: "comfyui",
      templateName: row.template_name,
      positivePrompt: row.positive_prompt,
      negativePrompt: row.negative_prompt,
      workflowSummary: parseJson<Record<string, unknown>>(row.workflow_summary_json) ?? {},
      parameters: parseJson<Record<string, unknown>>(row.parameters_json) ?? {},
      createdAt: row.created_at
    };
  }

  hasArtworkPath(path: string): boolean {
    return Boolean(
      this.#database
        .prepare(
          `SELECT 1 AS found
             FROM (
               SELECT path AS local_path FROM artworks WHERE path = ?
               UNION ALL
               SELECT path AS local_path FROM assets WHERE path = ?
               UNION ALL
               SELECT thumbnail_path AS local_path FROM assets WHERE thumbnail_path = ?
             )
            LIMIT 1`
        )
        .get(path, path, path)
    );
  }

  hasAvatarPath(path: string): boolean {
    return Boolean(
      this.#database.prepare("SELECT 1 AS found FROM artists WHERE avatar_local_path = ?").get(path)
    );
  }

  storageMigrationFiles(oldDirectory: string, newDirectory: string): { sourcePath: string; targetPath: string }[] {
    const roots = [
      [resolve(oldDirectory), resolve(newDirectory)],
      [resolve(oldDirectory, "..", "avatars"), resolve(newDirectory, "..", "avatars")]
    ];
    const rows = this.#database.prepare(`SELECT aw.path FROM artworks aw JOIN assets a ON a.legacy_artwork_id = aw.id JOIN works w ON w.id = a.work_id WHERE w.ownership = 'managed'
      UNION SELECT a.path FROM assets a JOIN works w ON w.id = a.work_id WHERE w.ownership = 'managed'
      UNION SELECT a.thumbnail_path AS path FROM assets a JOIN works w ON w.id = a.work_id WHERE w.ownership = 'managed' AND a.thumbnail_path IS NOT NULL
      UNION SELECT avatar_local_path AS path FROM artists WHERE avatar_local_path IS NOT NULL`).all() as { path: string }[];
    return rows.flatMap(({ path }) => {
      for (const [source, target] of roots) {
        const rel = relative(source!, resolve(path));
        if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
          const targetPath = resolve(target!, rel);
          return resolve(path).toLowerCase() === targetPath.toLowerCase() ? [] : [{ sourcePath: resolve(path), targetPath }];
        }
      }
      return [];
    });
  }

  migrateArtworkStoragePaths(oldDirectory: string, newDirectory: string, verifiedSourcePaths?: ReadonlySet<string>): StorageMigrationResult {
    const normOld = resolve(oldDirectory);
    const normNew = resolve(newDirectory);
    const normOldAvatarDir = resolve(normOld, "..", "avatars");
    const normNewAvatarDir = resolve(normNew, "..", "avatars");

    let migratedArtworks = 0;
    let migratedAssets = 0;
    let migratedAvatars = 0;

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      if (verifiedSourcePaths && this.storageMigrationFiles(normOld, normNew).some(({ sourcePath }) => !verifiedSourcePaths.has(sourcePath.toLowerCase()))) {
        throw new Error("迁移期间图库发生变化，请重新迁移；原文件和图库记录均已保留");
      }
      const artworks = this.#database
        .prepare("SELECT aw.id, aw.path FROM artworks aw JOIN assets a ON a.legacy_artwork_id = aw.id JOIN works w ON w.id = a.work_id WHERE w.ownership = 'managed'")
        .all() as unknown as { id: string; path: string }[];

      const updateArtworkStmt = this.#database.prepare(
        "UPDATE artworks SET path = ?, file_name = ? WHERE id = ?"
      );
      for (const artwork of artworks) {
        const rel = relative(normOld, resolve(artwork.path));
        if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
          const nextPath = resolve(normNew, rel);
          updateArtworkStmt.run(nextPath, basename(nextPath), artwork.id);
          migratedArtworks += 1;
        }
      }

      const assets = this.#database
        .prepare("SELECT a.id, a.path, a.thumbnail_path FROM assets a JOIN works w ON w.id = a.work_id WHERE w.ownership = 'managed'")
        .all() as unknown as { id: string; path: string; thumbnail_path: string | null }[];

      const updateAssetStmt = this.#database.prepare(
        "UPDATE assets SET path = ?, thumbnail_path = ? WHERE id = ?"
      );
      for (const asset of assets) {
        let changed = false;
        let nextPath = asset.path;
        let nextThumb = asset.thumbnail_path;

        const relPath = relative(normOld, resolve(asset.path));
        if (relPath !== ".." && !relPath.startsWith(`..${sep}`) && !isAbsolute(relPath)) {
          nextPath = resolve(normNew, relPath);
          changed = true;
          migratedAssets += 1;
        }

        if (asset.thumbnail_path) {
          const relThumb = relative(normOld, resolve(asset.thumbnail_path));
          if (relThumb !== ".." && !relThumb.startsWith(`..${sep}`) && !isAbsolute(relThumb)) {
            nextThumb = resolve(normNew, relThumb);
            changed = true;
          }
        }

        if (changed) {
          updateAssetStmt.run(nextPath, nextThumb, asset.id);
        }
      }

      const artists = this.#database
        .prepare("SELECT id, avatar_local_path FROM artists WHERE avatar_local_path IS NOT NULL")
        .all() as unknown as { id: string; avatar_local_path: string }[];

      const updateArtistStmt = this.#database.prepare(
        "UPDATE artists SET avatar_local_path = ? WHERE id = ?"
      );
      for (const artist of artists) {
        const resolvedAvatar = resolve(artist.avatar_local_path);
        const relToAvatars = relative(normOldAvatarDir, resolvedAvatar);
        if (relToAvatars !== ".." && !relToAvatars.startsWith(`..${sep}`) && !isAbsolute(relToAvatars)) {
          const nextAvatar = resolve(normNewAvatarDir, relToAvatars);
          updateArtistStmt.run(nextAvatar, artist.id);
          migratedAvatars += 1;
          continue;
        }
        const relToOld = relative(normOld, resolvedAvatar);
        if (relToOld !== ".." && !relToOld.startsWith(`..${sep}`) && !isAbsolute(relToOld)) {
          const nextAvatar = resolve(normNew, relToOld);
          updateArtistStmt.run(nextAvatar, artist.id);
          migratedAvatars += 1;
        }
      }

      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }

    return {
      migratedArtworks,
      migratedAssets,
      migratedAvatars,
      sourceDirectory: normOld,
      targetDirectory: normNew
    };
  }

  countArtworksOutsideDirectory(directory: string): number {
    const norm = resolve(directory);
    const artworks = this.#database
      .prepare("SELECT path FROM artworks")
      .all() as unknown as { path: string }[];
    let count = 0;
    for (const item of artworks) {
      const rel = relative(norm, resolve(item.path));
      if (rel.startsWith("..") || isAbsolute(rel)) {
        count += 1;
      }
    }
    return count;
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

  listCollectionSummaries(): CollectionSummary[] { return this.#directory.listCollectionSummaries(); }
  listArtistSummaries(): ArtistSummary[] { return this.#directory.listArtistSummaries(); }
  querySavedViewSummaries(query: DirectoryPageQuery = {}): SavedViewSummaryResult { return this.#directory.querySavedViewSummaries(query); }
  listScopedArtworks(scope: GalleryScope): ScopedArtworkRecord[] { return this.#directory.listScopedArtworks(scope); }
  queryArtworkPages(query: ArtworkPageQuery = {}): ArtworkPageQueryResult { return this.#directory.queryArtworkPages(query); }
  addArtworksToCollection(artworkIds: readonly string[], collectionId: string): number { return this.#directory.addArtworksToCollection(artworkIds, collectionId); }
  hasCollectionArtwork(collectionId: string, artworkId: string): boolean { return this.#directory.hasCollectionArtwork(collectionId, artworkId); }

  listSavedCollectionViews(): SavedCollectionView[] {
    return this.#savedCollectionViews.list();
  }

  getSavedCollectionView(id: string): SavedCollectionView | null {
    return this.#savedCollectionViews.get(id);
  }

  createSavedCollectionView(draft: SavedCollectionViewDraft): SavedCollectionView {
    return this.#savedCollectionViews.create(draft);
  }

  updateSavedCollectionView(id: string, draft: SavedCollectionViewDraft): SavedCollectionView | null {
    return this.#savedCollectionViews.update(id, draft);
  }

  deleteSavedCollectionView(id: string): boolean {
    return this.#savedCollectionViews.delete(id);
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

  getLatestRemoteImageReview(normalizedUrl: string): RemoteImageReviewRecord | null {
    if (!normalizedUrl) return null;
    const row = this.#database
      .prepare(
        `SELECT normalized_url, content_hash, engine, engine_version,
                rules_fingerprint, assessment_json, decision_json,
                byte_length, reviewed_at
           FROM remote_image_reviews
          WHERE normalized_url = ?
          ORDER BY reviewed_at DESC
          LIMIT 1`
      )
      .get(normalizedUrl) as RemoteImageReviewRow | undefined;
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

  findRemoteImageReviewByArtworkId(artworkId: string): RemoteImageReviewRecord | null {
    if (!artworkId || !/^\d+$/.test(artworkId)) return null;
    const row = this.#database
      .prepare(
        `SELECT normalized_url, content_hash, engine, engine_version,
                rules_fingerprint, assessment_json, decision_json,
                byte_length, reviewed_at
           FROM remote_image_reviews
          WHERE normalized_url LIKE '%/' || ? || '_p%'
             OR normalized_url LIKE '%/' || ? || '.%'
          ORDER BY reviewed_at DESC
          LIMIT 1`
      )
      .get(artworkId, artworkId) as RemoteImageReviewRow | undefined;
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

  gallerySearchAsset(workId: string, assetId: string): WorkAssetRecord | null {
    const row = this.#database.prepare(`SELECT a.* FROM assets a JOIN works w ON w.id=a.work_id
      WHERE a.id=? AND a.work_id=? AND w.deleted_at IS NULL AND a.media_type='image' AND a.file_state='available'`)
      .get(assetId,workId) as unknown as WorkAssetRow | undefined;
    return row ? mapWorkAsset(row) : null;
  }

  listGallerySearchAssets(query: WorkQuery, offset = 0, limit = 100): Array<{ asset: WorkAssetRecord; title: string }> {
    const predicate = workQueryPredicate(query);
    const rows = this.#database.prepare(`SELECT a.*, w.title AS work_title FROM assets a JOIN works w ON w.id=a.work_id
      LEFT JOIN artists ar ON ar.id=w.artist_id
      WHERE ${predicate.sql} AND a.media_type='image' AND a.file_state='available'
      ORDER BY w.saved_at DESC, w.id, a.page_index, a.id LIMIT ? OFFSET ?`)
      .all(...predicate.params, clampInteger(limit,100,1,200),clampInteger(offset,0,0,10_000_000)) as unknown as Array<WorkAssetRow & { work_title: string }>;
    return rows.map(row => ({ asset: mapWorkAsset(row), title: row.work_title }));
  }

  listWorkbenchAssets(scope: AnalysisScope, offset = 0, limit = 100): Array<{ asset: WorkAssetRecord; title: string }> {
    const predicate = analysisScopePredicate(scope);
    const rows = this.#database.prepare(`SELECT a.*, w.title AS work_title FROM assets a JOIN works w ON w.id=a.work_id
      WHERE ${predicate.sql} AND a.media_type='image' AND a.file_state='available'
      ORDER BY w.saved_at DESC, w.id, a.page_index, a.id LIMIT ? OFFSET ?`)
      .all(...predicate.params, Math.max(1,Math.min(200,Math.trunc(limit))),Math.max(0,Math.trunc(offset))) as unknown as Array<WorkAssetRow & { work_title: string }>;
    return rows.map(row => ({ asset: mapWorkAsset(row), title: row.work_title }));
  }

  previewAnalysisScope(scope: AnalysisScope, engine: string, engineVersion?: string): AnalysisScopePreview {
    const predicate = analysisScopePredicate(scope);
    const countRow = this.#database.prepare("SELECT COUNT(*) AS count FROM works w WHERE " + predicate.sql).get(...predicate.params) as { count: number };
    if (!countRow.count) return { scope, workCount: 0, assetCount: 0, cachedAssetCount: 0 };
    const isVisionSuite = engine.startsWith("technical_visual_") || engine.startsWith("fine_art_") || engine.startsWith("character_presence_");
    const wherePage = isVisionSuite ? " AND a.page_index = 0" : "";
    const query = isVisionSuite
      ? `SELECT COUNT(DISTINCT a.id) AS asset_count,
                COUNT(DISTINCT CASE WHEN vr.asset_id IS NOT NULL THEN a.id END) AS cached_count
           FROM assets a JOIN works w ON w.id = a.work_id
           LEFT JOIN vision_evaluation_results vr
             ON vr.asset_id = a.id AND vr.suite_id = ? AND vr.asset_version = a.updated_at AND vr.status = 'success'
          WHERE ${predicate.sql}
            AND a.media_type = 'image' AND a.file_state = 'available'${wherePage}`
      : `SELECT COUNT(DISTINCT a.id) AS asset_count,
                COUNT(DISTINCT CASE WHEN ar.asset_id IS NOT NULL THEN a.id END) AS cached_count
           FROM assets a JOIN works w ON w.id = a.work_id
           LEFT JOIN analysis_asset_results ar
             ON ar.asset_id = a.id AND ar.engine = ? AND ar.asset_updated_at = a.updated_at${engineVersion ? " AND ar.engine_version = ?" : ""}
          WHERE ${predicate.sql}
            AND a.media_type = 'image' AND a.file_state = 'available'${wherePage}`;

    const row = this.#database.prepare(query).get(engine, ...(!isVisionSuite && engineVersion ? [engineVersion] : []), ...predicate.params) as { asset_count: number; cached_count: number };
    return {
      scope,
      workCount: Number(countRow.count),
      assetCount: Number(row.asset_count),
      cachedAssetCount: Number(row.cached_count)
    };
  }

  createAnalysisJob(scope: AnalysisScope, engine: string): AnalysisJob {
    const workIds = this.#workIdsForAnalysisScope(scope);
    const jobId = randomUUID();
    const now = new Date().toISOString();
    const isVisionSuite = engine.startsWith("technical_visual_") || engine.startsWith("fine_art_") || engine.startsWith("character_presence_");
    const pageCondition = isVisionSuite ? " AND page_index = 0" : "";

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
          `SELECT id FROM assets WHERE work_id IN (${placeholders}) AND media_type = 'image' AND file_state = 'available'${pageCondition} ORDER BY work_id, page_index`
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

  /** Task chrome never expands per-image outcomes or recomputes album suggestions. */
  listAnalysisTaskSummaries(): AnalysisTaskSummary[] {
    const rows = this.#database.prepare(`SELECT j.*,
      (SELECT COUNT(*) FROM analysis_job_items i WHERE i.job_id = j.id AND i.status = 'error') AS failed_items
      FROM analysis_jobs j ORDER BY j.created_at DESC LIMIT 30`).all() as unknown as (AnalysisJobRow & { failed_items: number })[];
    return rows.map((row) => ({ id: row.id, status: row.status as AnalysisTaskSummary["status"],
      scopeType: parseJson<AnalysisScope>(row.scope_json)?.type ?? "all", engine: row.engine,
      workCount: row.work_count, totalItems: row.total_items, processedItems: row.processed_items,
      failedItems: row.failed_items, cancelRequested: row.cancel_requested === 1, error: row.error, createdAt: row.created_at }));
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

  getCachedAssetAnalysis(assetId: string, assetUpdatedAt: string, engine: string, engineVersion?: string): VisionAssessment | null {
    const row = this.#database.prepare(
      `SELECT assessment_json FROM analysis_asset_results WHERE asset_id = ? AND asset_updated_at = ? AND engine = ?${engineVersion ? " AND engine_version = ?" : ""}`
    ).get(assetId, assetUpdatedAt, engine, ...(engineVersion ? [engineVersion] : [])) as { assessment_json: string } | undefined;
    return row ? parseJson<VisionAssessment>(row.assessment_json) : null;
  }

  getStoredAssetAssessment(workId: string, assetId: string): VisionAssessment | null {
    const row = this.#database.prepare(
      `SELECT COALESCE(
         (SELECT r.assessment_json FROM analysis_asset_results r
          WHERE r.asset_id = a.id AND r.asset_updated_at = a.updated_at
          ORDER BY r.analyzed_at DESC LIMIT 1), legacy.assessment_json) AS assessment_json
       FROM assets a JOIN works w ON w.id = a.work_id
       LEFT JOIN artworks legacy ON legacy.id = a.legacy_artwork_id
       WHERE a.work_id = ? AND a.id = ? AND w.deleted_at IS NULL`
    ).get(workId, assetId) as { assessment_json: string | null } | undefined;
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

  saveVisionEvaluationResult(result: VisionEvaluationResult): void {
    const now = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare(
        `INSERT INTO vision_evaluation_results
           (id, work_id, asset_id, scope, kind, suite_id, suite_version,
            status, reason_code, reading_json, summary, provider_id, model_id,
            evaluator_version, prompt_version, preprocessing_fingerprint,
            asset_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           reason_code = excluded.reason_code,
           reading_json = excluded.reading_json,
           summary = excluded.summary,
           updated_at = excluded.updated_at`
      ).run(
        result.id,
        result.workId,
        result.assetId,
        result.scope,
        result.kind,
        result.suiteId,
        result.suiteVersion,
        result.status,
        result.reasonCode ?? null,
        result.reading ? JSON.stringify(result.reading) : null,
        result.summary ?? null,
        result.providerId ?? null,
        result.modelId ?? null,
        result.evaluatorVersion,
        result.promptVersion ?? null,
        result.preprocessingFingerprint,
        result.assetVersion,
        result.createdAt || now,
        result.updatedAt || now
      );

      this.#database.prepare("DELETE FROM vision_dimension_scores WHERE result_id = ?").run(result.id);
      const insertDim = this.#database.prepare(
        `INSERT INTO vision_dimension_scores (result_id, dimension_key, label, score, explanation)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const dim of result.dimensions) {
        insertDim.run(
          result.id,
          dim.key,
          canonicalVisionDimensionLabel(result.suiteId, result.suiteVersion, dim.key, dim.label),
          dim.score,
          dim.explanation ?? null
        );
      }
      this.#database.prepare(
        `DELETE FROM vision_evaluation_results
          WHERE work_id = ? AND suite_id = ? AND id <> ?`
      ).run(result.workId, result.suiteId, result.id);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  getVisionEvaluationResult(workId: string, suiteId: string, version = 1): VisionEvaluationResult | null {
    const row = this.#database.prepare(
      `SELECT * FROM vision_evaluation_results
        WHERE work_id = ? AND suite_id = ? AND suite_version = ?
        ORDER BY created_at DESC LIMIT 1`
    ).get(workId, suiteId, version) as VisionEvaluationResultRow | undefined;
    if (!row) return null;
    return this.#mapVisionEvaluationResult(row);
  }

  getCachedVisionEvaluation(
    assetId: string,
    kind: VisionEvaluationKind,
    suiteId: string,
    suiteVersion: number,
    preprocessingFingerprint: string,
    assetVersion: string
  ): VisionEvaluationResult | null {
    const row = this.#database.prepare(
      `SELECT * FROM vision_evaluation_results
        WHERE asset_id = ? AND kind = ? AND suite_id = ? AND suite_version = ?
          AND preprocessing_fingerprint = ? AND asset_version = ? AND status = 'success'
        ORDER BY created_at DESC LIMIT 1`
    ).get(assetId, kind, suiteId, suiteVersion, preprocessingFingerprint, assetVersion) as VisionEvaluationResultRow | undefined;
    if (!row) return null;
    return this.#mapVisionEvaluationResult(row);
  }

  listVisionEvaluationsForWork(workId: string): VisionEvaluationResult[] {
    const rows = this.#database.prepare(
      `SELECT * FROM (
         SELECT result.*, ROW_NUMBER() OVER (
           PARTITION BY result.suite_id
           ORDER BY result.updated_at DESC, result.created_at DESC, result.rowid DESC
         ) AS suite_rank
         FROM vision_evaluation_results result
         WHERE result.work_id = ?
       ) ranked
       WHERE suite_rank = 1
       ORDER BY updated_at DESC, created_at DESC`
    ).all(workId) as unknown as VisionEvaluationResultRow[];
    return rows.map((row) => this.#mapVisionEvaluationResult(row));
  }

  queryWorksByVisionScore(dimensionKey: string, minScore: number, maxScore: number, suiteId?: string): string[] {
    const query = suiteId
      ? `SELECT DISTINCT r.work_id
           FROM vision_dimension_scores s
           JOIN vision_evaluation_results r ON r.id = s.result_id
          WHERE s.dimension_key = ? AND s.score BETWEEN ? AND ? AND r.suite_id = ?`
      : `SELECT DISTINCT r.work_id
           FROM vision_dimension_scores s
           JOIN vision_evaluation_results r ON r.id = s.result_id
          WHERE s.dimension_key = ? AND s.score BETWEEN ? AND ?`;
    const params = suiteId ? [dimensionKey, minScore, maxScore, suiteId] : [dimensionKey, minScore, maxScore];
    const rows = this.#database.prepare(query).all(...params) as unknown as Array<{ work_id: string }>;
    return rows.map((r) => r.work_id);
  }

  queryWorksByTags(
    tags: string[],
    minConfidence = 0.4,
    scope?: AnalysisScope
  ): TriageQueryResultItem[] {
    return this.queryWorksByFilterRules(tags.map((tag) => ({
      id: tag, name: tag, label: tag.trim().toLowerCase().replaceAll(" ", "_"),
      minimumConfidence: minConfidence, enabled: true, action: "hide", priority: 0
    })), scope);
  }

  queryWorksByFilterRules(
    rules: readonly FilterRule[], scope?: AnalysisScope,
    identity?: { engine: string; engineVersion: string }
  ): TriageQueryResultItem[] {
    const thresholds = new Map<string, number>();
    for (const rule of rules) {
      if (!rule.enabled) continue;
      thresholds.set(rule.label, Math.min(thresholds.get(rule.label) ?? 1, rule.minimumConfidence));
    }
    if (!thresholds.size) return [];
    const conditions = ["w.deleted_at IS NULL", "a.media_type = 'image'", "a.file_state = 'available'",
      "ar.asset_updated_at = a.updated_at"];
    const params: Array<string | number> = [...thresholds].flatMap(([tag, threshold]) => [tag, threshold]);
    if (scope?.type === "selected") {
      if (!scope.workIds.length) return [];
      conditions.push(`w.id IN (${scope.workIds.map(() => "?").join(",")})`);
      params.push(...scope.workIds);
    } else if (scope?.type === "artist") {
      conditions.push("w.artist_id = ?"); params.push(scope.artistId);
    } else if (scope?.type === "collection") {
      conditions.push("EXISTS (SELECT 1 FROM collection_works cw WHERE cw.work_id = w.id AND cw.collection_id = ?)");
      params.push(scope.collectionId);
    }
    if (identity) {
      conditions.push("ar.engine = ?", "ar.engine_version = ?");
      params.push(identity.engine, identity.engineVersion);
    }
    // Match in SQLite; unrelated assessments and full label payloads stay in the store.
    const safeJson = "CASE WHEN json_valid(ar.assessment_json) THEN ar.assessment_json ELSE '{}' END";
    const rows = this.#database.prepare(`
      WITH wanted(tag, threshold) AS (VALUES ${[...thresholds].map(() => "(?, ?)").join(",")})
      SELECT a.work_id, labels.key AS tag, MAX(labels.value) AS confidence
        FROM analysis_asset_results ar
        JOIN assets a ON a.id = ar.asset_id
        JOIN works w ON w.id = a.work_id
        JOIN json_each(${safeJson}, '$.labels') labels
        JOIN wanted ON wanted.tag = labels.key
       WHERE ${conditions.join(" AND ")}
         AND json_extract(${safeJson}, '$.status') = 'complete'
         AND labels.type IN ('integer', 'real') AND labels.value BETWEEN wanted.threshold AND 1
       GROUP BY a.work_id, labels.key
       ORDER BY a.work_id, confidence DESC, labels.key
    `).all(...params) as Array<{ work_id: string; tag: string; confidence: number }>;
    const resultMap = new Map<string, Array<{ tag: string; confidence: number }>>();
    for (const row of rows) {
      const matched = resultMap.get(row.work_id) ?? [];
      matched.push({ tag: row.tag, confidence: row.confidence });
      resultMap.set(row.work_id, matched);
    }

    if (resultMap.size === 0) return [];

    const items: TriageQueryResultItem[] = [];
    for (const [workId, matchedTags] of resultMap.entries()) {
      const work = this.getWork(workId);
      if (work) {
        const coverAsset = (work.coverAssetId ? work.assets.find((a) => a.id === work.coverAssetId) : null) ?? work.assets[0] ?? null;
        const workItem: WorkListItem = {
          id: work.id,
          sourcePlatform: work.sourcePlatform,
          sourceWorkId: work.sourceWorkId,
          title: work.title,
          workType: work.workType,
          publishedAt: work.publishedAt,
          ownership: work.ownership,
          artistId: work.artistId,
          artistName: work.artistName,
          pageCount: work.pageCount,
          favorite: work.favorite,
          totalByteLength: work.assets.reduce((sum, a) => sum + (a.byteLength || 0), 0),
          coverAsset,
          collectionIds: work.collectionIds,
          savedAt: work.savedAt
        };
        items.push({
          work: workItem,
          matchedTags
        });
      }
    }

    return items;
  }

  recordExternalVisionRequest(req: {
    id: string;
    resultId?: string | null;
    providerId: string;
    modelId: string;
    status: string;
    reasonCode?: string | null;
    latencyMs?: number | null;
    attemptCount?: number;
  }): void {
    this.#database.prepare(
      `INSERT INTO external_vision_requests
         (id, result_id, provider_id, model_id, status, reason_code, latency_ms, attempt_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.id,
      req.resultId ?? null,
      req.providerId,
      req.modelId,
      req.status,
      req.reasonCode ?? null,
      req.latencyMs ?? null,
      req.attemptCount ?? 1,
      new Date().toISOString()
    );
  }

  #mapVisionEvaluationResult(row: VisionEvaluationResultRow): VisionEvaluationResult {
    const dimRows = this.#database.prepare(
      `SELECT dimension_key, label, score, explanation
         FROM vision_dimension_scores
        WHERE result_id = ?
        ORDER BY rowid`
    ).all(row.id) as unknown as VisionDimensionScoreRow[];

    return {
      id: row.id,
      workId: row.work_id,
      assetId: row.asset_id,
      scope: row.scope as VisionEvaluationScope,
      kind: row.kind as VisionEvaluationKind,
      suiteId: row.suite_id,
      suiteVersion: Number(row.suite_version),
      status: row.status as VisionEvaluationStatus,
      reasonCode: row.reason_code ?? undefined,
      dimensions: dimRows.map((d) => ({
        key: d.dimension_key,
        label: canonicalVisionDimensionLabel(row.suite_id, Number(row.suite_version), d.dimension_key, d.label),
        score: Number(d.score),
        explanation: d.explanation ?? undefined
      })),
      reading: parseJson<VisionEvaluationResult["reading"]>(row.reading_json) ?? undefined,
      summary: row.summary ?? undefined,
      providerId: row.provider_id ?? undefined,
      modelId: row.model_id ?? undefined,
      evaluatorVersion: row.evaluator_version,
      promptVersion: row.prompt_version ?? undefined,
      preprocessingFingerprint: row.preprocessing_fingerprint,
      assetVersion: row.asset_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
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
      CREATE INDEX IF NOT EXISTS idx_artworks_page_order ON artworks(imported_at DESC, id);
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
    this.#workNames.ensureSchema();
    this.#migrateLegacyArtworksToWorks();
    this.#savedCollectionViews.ensureSchema();
    this.#database.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, ?)").run(new Date().toISOString());
    this.#database.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (3, ?)").run(new Date().toISOString());
    this.#ensureVisionSchema();
    this.#ensureComfyUiSchema();
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
      CREATE INDEX IF NOT EXISTS idx_works_last_viewed_at
        ON works(last_viewed_at DESC, id)
        WHERE deleted_at IS NULL AND last_viewed_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_works_artist ON works(artist_id, saved_at DESC);
      CREATE INDEX IF NOT EXISTS idx_assets_work ON assets(work_id, page_index);
      CREATE INDEX IF NOT EXISTS idx_assets_content_hash ON assets(content_hash)
        WHERE content_hash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_assets_legacy_images
        ON assets(legacy_artwork_id, work_id, id)
        WHERE media_type = 'image' AND legacy_artwork_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_assets_thumbnail_path
        ON assets(thumbnail_path) WHERE thumbnail_path IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_assets_pending_thumbnails
        ON assets(created_at, id)
        WHERE media_type = 'image' AND file_state = 'available' AND thumbnail_path IS NULL;
      CREATE INDEX IF NOT EXISTS idx_assets_cached_thumbnails
        ON assets(created_at, id)
        WHERE media_type = 'image' AND file_state = 'available' AND thumbnail_path IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_artists_avatar_local_path
        ON artists(avatar_local_path) WHERE avatar_local_path IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_collection_works_work ON collection_works(work_id);
    `);
  }

  #ensureVisionSchema(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS vision_evaluation_results (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        scope TEXT NOT NULL CHECK (scope IN ('cover_asset')),
        kind TEXT NOT NULL CHECK (kind IN ('local_technical_profile', 'external_fixed_suite', 'external_adaptive_highlights')),
        suite_id TEXT NOT NULL,
        suite_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        reason_code TEXT,
        reading_json TEXT,
        summary TEXT,
        provider_id TEXT,
        model_id TEXT,
        evaluator_version TEXT NOT NULL,
        prompt_version TEXT,
        preprocessing_fingerprint TEXT NOT NULL,
        asset_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vision_dimension_scores (
        result_id TEXT NOT NULL REFERENCES vision_evaluation_results(id) ON DELETE CASCADE,
        dimension_key TEXT NOT NULL,
        label TEXT NOT NULL,
        score REAL NOT NULL CHECK(score >= 0 AND score <= 100),
        explanation TEXT,
        PRIMARY KEY (result_id, dimension_key)
      );

      CREATE TABLE IF NOT EXISTS external_vision_requests (
        id TEXT PRIMARY KEY,
        result_id TEXT,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        status TEXT NOT NULL,
        reason_code TEXT,
        latency_ms INTEGER,
        attempt_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_vision_eval_work ON vision_evaluation_results(work_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_vision_eval_asset_cache ON vision_evaluation_results(asset_id, kind, suite_id, suite_version, preprocessing_fingerprint, asset_version);
      CREATE INDEX IF NOT EXISTS idx_vision_dim_query ON vision_dimension_scores(dimension_key, score);
    `);
    const columns = new Set(
      (this.#database.prepare("PRAGMA table_info(vision_evaluation_results)").all() as unknown as Array<{ name: string }>)
        .map((column) => column.name)
    );
    if (!columns.has("reading_json")) {
      this.#database.exec("ALTER TABLE vision_evaluation_results ADD COLUMN reading_json TEXT");
    }
    const now = new Date().toISOString();
    this.#database.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (4, ?)").run(now);
    this.#database.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (6, ?)").run(now);
  }

  #ensureComfyUiSchema(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS comfyui_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        source_work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        source_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        template_id TEXT NOT NULL,
        template_name TEXT NOT NULL,
        positive_prompt TEXT NOT NULL,
        negative_prompt TEXT NOT NULL,
        remote_prompt_id TEXT,
        output_work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
        workflow_summary_json TEXT NOT NULL,
        parameters_json TEXT NOT NULL,
        error TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS generation_provenance (
        output_work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
        source_work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        source_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('comfyui')),
        template_name TEXT NOT NULL,
        positive_prompt TEXT NOT NULL,
        negative_prompt TEXT NOT NULL,
        workflow_summary_json TEXT NOT NULL,
        parameters_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_comfyui_jobs_created ON comfyui_jobs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_comfyui_jobs_status ON comfyui_jobs(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_generation_provenance_source ON generation_provenance(source_work_id, created_at DESC);
    `);
    this.#database.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (5, ?)").run(new Date().toISOString());
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
           title = CASE WHEN works.custom_title IS NOT NULL THEN works.custom_title WHEN excluded.source_platform = 'pixiv' THEN excluded.title ELSE works.title END,
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

function mapArtworkRows(rows: readonly ArtworkRow[]): ArtworkRecord[] {
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
      ...(row.display_name ? { displayName: row.display_name } : {}),
      importedAt: row.imported_at,
      assessment: parseJson<VisionAssessment>(row.assessment_json),
      decision: parseJson<FilterDecision>(row.decision_json),
      collectionIds: row.collection_id ? [row.collection_id] : [],
      source: parseArtworkSource(row)
    });
  }
  return [...byId.values()];
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

function mapComfyUiJob(row: ComfyUiJobRow): ComfyUiJob {
  const statuses: ComfyUiJobStatus[] = ["queued", "running", "completed", "failed", "cancelled"];
  const status = statuses.includes(row.status as ComfyUiJobStatus) ? row.status as ComfyUiJobStatus : "failed";
  return {
    id: row.id,
    status,
    sourceWorkId: row.source_work_id,
    sourceAssetId: row.source_asset_id,
    templateId: row.template_id,
    templateName: row.template_name,
    positivePrompt: row.positive_prompt,
    negativePrompt: row.negative_prompt,
    remotePromptId: row.remote_prompt_id,
    outputWorkId: row.output_work_id,
    workflowSummary: parseJson<Record<string, unknown>>(row.workflow_summary_json) ?? {},
    parameters: parseJson<Record<string, unknown>>(row.parameters_json) ?? {},
    error: row.error,
    cancelRequested: row.cancel_requested === 1,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
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
    lastViewedAt: row.last_viewed_at,
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

function canonicalVisionDimensionLabel(
  suiteId: string,
  suiteVersion: number,
  dimensionKey: string,
  fallback: string
): string {
  const suite = getVisionSuite(suiteId, suiteVersion);
  return suite?.dimensions.find((dimension) => dimension.key === dimensionKey)?.label ?? fallback;
}

function workQueryPredicate(query: WorkQuery): { sql: string; params: Array<string | number> } {
    const search = typeof query.search === "string" ? query.search.trim().slice(0, 200) : "";
    const clauses = ["w.deleted_at IS NULL"];
    const parameters: Array<string | number> = [];
    if (query.ownership === "managed" || query.ownership === "external") {
      clauses.push("w.ownership = ?");
      parameters.push(query.ownership);
    }
    if (typeof query.favorite === "boolean") {
      clauses.push("w.favorite = ?");
      parameters.push(query.favorite ? 1 : 0);
    }
    if (query.uncollected === true) {
      clauses.push("NOT EXISTS (SELECT 1 FROM collection_works uncollected_cw WHERE uncollected_cw.work_id = w.id)");
    }
    if (query.viewedOnly === true) clauses.push("w.last_viewed_at IS NOT NULL");
    if (query.unattributed === true) clauses.push("w.artist_id IS NULL");
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
    const includedCollections = Array.isArray(query.collectionIds)
      ? [...new Set(query.collectionIds.filter((id): id is string => typeof id === "string" && Boolean(id)))]
      : (typeof query.collectionId === "string" && query.collectionId ? [query.collectionId] : []);
    const excludedCollections = Array.isArray(query.excludedCollectionIds)
      ? [...new Set(query.excludedCollectionIds.filter((id): id is string => typeof id === "string" && Boolean(id)))]
      : [];

    if (includedCollections.length === 1 && includedCollections[0]) {
      clauses.push(
        "EXISTS (SELECT 1 FROM collection_works filter_cw WHERE filter_cw.work_id = w.id AND filter_cw.collection_id = ?)"
      );
      parameters.push(includedCollections[0]);
    } else if (includedCollections.length > 1) {
      if (query.collectionMatchMode === "all") {
        for (const colId of includedCollections) {
          clauses.push(
            "EXISTS (SELECT 1 FROM collection_works filter_cw WHERE filter_cw.work_id = w.id AND filter_cw.collection_id = ?)"
          );
          parameters.push(colId);
        }
      } else {
        const placeholders = includedCollections.map(() => "?").join(", ");
        clauses.push(
          `EXISTS (SELECT 1 FROM collection_works filter_cw WHERE filter_cw.work_id = w.id AND filter_cw.collection_id IN (${placeholders}))`
        );
        parameters.push(...includedCollections);
      }
    }

    if (excludedCollections.length > 0) {
      const placeholders = excludedCollections.map(() => "?").join(", ");
      clauses.push(
        `NOT EXISTS (SELECT 1 FROM collection_works filter_ex WHERE filter_ex.work_id = w.id AND filter_ex.collection_id IN (${placeholders}))`
      );
      parameters.push(...excludedCollections);
    }
    return { sql: clauses.join(" AND "), params: parameters };
}
