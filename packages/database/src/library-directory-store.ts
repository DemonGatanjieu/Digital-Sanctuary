import type { DatabaseSync } from "node:sqlite";
import type { ArtistRecord, ArtistSummary, ArtworkPageQuery, ArtworkPageQueryResult, CollectionSummary, DirectoryPageQuery, FilterDecision, GalleryScope, SavedViewSummaryResult, ScopedArtworkRecord, VisionAssessment, WorkAssetRecord, WorkQuery, WorkQueryResult } from "@sanctuary/domain";
import { mapSavedCollectionView } from "./saved-collection-view-store.js";

type Row = Record<string, string | number | null>;
const pageFrom = `FROM artworks aw JOIN assets a ON a.legacy_artwork_id = aw.id
  JOIN works w ON w.id = a.work_id`;
const validPage = "w.deleted_at IS NULL AND a.media_type = 'image' AND a.legacy_artwork_id IS NOT NULL";
// Books retain their complete indexed manifest; new selections require a usable local asset.
const availablePage = `${validPage} AND a.file_state = 'available'`;
const pageSelect = `SELECT aw.*, w.custom_title AS display_name, a.work_id AS library_work_id, a.id AS asset_id,
  a.page_index AS asset_page_index, a.thumbnail_path,
  (SELECT GROUP_CONCAT(ca.collection_id, char(31)) FROM collection_artworks ca WHERE ca.artwork_id = aw.id) AS collection_ids`;
const pageOrder = "aw.imported_at DESC, aw.id ASC";

/** Directory queries return bounded previews, not the full legacy library. */
export class LibraryDirectoryStore {
  constructor(private readonly database: DatabaseSync, private readonly queryWorkPage: (query: WorkQuery) => WorkQueryResult) {}

  listCollectionSummaries(): CollectionSummary[] {
    const rows = this.database.prepare(`WITH work_counts AS (
      SELECT cw.collection_id, COUNT(*) AS work_count, SUM(w.page_count) AS page_count
      FROM collection_works cw JOIN works w ON w.id = cw.work_id WHERE w.deleted_at IS NULL GROUP BY cw.collection_id
    ), page_counts AS (
      SELECT ca.collection_id, COUNT(*) AS book_page_count FROM collection_artworks ca
      JOIN assets a ON a.legacy_artwork_id = ca.artwork_id JOIN works w ON w.id = a.work_id
      WHERE w.deleted_at IS NULL AND a.media_type = 'image' AND a.legacy_artwork_id IS NOT NULL GROUP BY ca.collection_id
    ) SELECT c.*, COALESCE(wc.work_count, 0) AS work_count, COALESCE(wc.page_count, 0) AS page_count,
      COALESCE(pc.book_page_count, 0) AS book_page_count FROM collections c
      LEFT JOIN work_counts wc ON wc.collection_id = c.id LEFT JOIN page_counts pc ON pc.collection_id = c.id
      ORDER BY c.created_at, c.id`).all() as Row[];
    const covers = this.database.prepare(`WITH candidates AS (
      SELECT c.id AS collection_id, a.id AS asset_id, aw.imported_at AS date,
        CASE WHEN aw.id = c.cover_artwork_id THEN 0 ELSE 1 END AS priority
      FROM collections c JOIN collection_artworks ca ON ca.collection_id = c.id
      JOIN artworks aw ON aw.id = ca.artwork_id JOIN assets a ON a.legacy_artwork_id = aw.id
      JOIN works w ON w.id = a.work_id WHERE w.deleted_at IS NULL AND a.media_type = 'image'
      UNION ALL
      SELECT c.id, a.id, w.saved_at, CASE WHEN w.id = c.cover_work_id AND c.cover_artwork_id IS NULL THEN 0 ELSE 2 END
      FROM collections c JOIN collection_works cw ON cw.collection_id = c.id
      JOIN works w ON w.id = cw.work_id JOIN assets a ON a.id = w.cover_asset_id
      WHERE w.deleted_at IS NULL AND a.media_type = 'image'
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER(PARTITION BY collection_id ORDER BY priority, date DESC, asset_id) AS position FROM candidates
    ) SELECT a.*, r.collection_id FROM ranked r JOIN assets a ON a.id = r.asset_id WHERE r.position = 1`).all() as Row[];
    const coverByCollection = new Map(covers.map((row) => [String(row.collection_id), assetRecord(row)]));
    return rows.map((row) => ({
      id: String(row.id), name: String(row.name), description: String(row.description), createdAt: String(row.created_at),
      ...(row.cover_artwork_id ? { coverArtworkId: String(row.cover_artwork_id) } : {}),
      workCount: Number(row.work_count), pageCount: Number(row.page_count), bookPageCount: Number(row.book_page_count),
      coverAsset: coverByCollection.get(String(row.id)) ?? null
    }));
  }

  listArtistSummaries(): ArtistSummary[] {
    const artists = this.database.prepare("SELECT * FROM artists ORDER BY updated_at DESC, id").all() as Row[];
    const counts = this.database.prepare(`SELECT artist_id, COUNT(*) AS work_count, SUM(page_count) AS page_count
      FROM works WHERE deleted_at IS NULL GROUP BY artist_id`).all() as Row[];
    const pages = this.database.prepare(`SELECT w.artist_id, COUNT(*) AS book_page_count FROM assets a JOIN works w ON w.id = a.work_id
      WHERE w.deleted_at IS NULL AND a.media_type = 'image' AND a.legacy_artwork_id IS NOT NULL GROUP BY w.artist_id`).all() as Row[];
    const previews = this.database.prepare(`WITH ranked AS (
      SELECT w.artist_id, a.id AS asset_id, ROW_NUMBER() OVER(PARTITION BY w.artist_id ORDER BY w.saved_at DESC, w.id) AS position
      FROM works w JOIN assets a ON a.id = w.cover_asset_id WHERE w.deleted_at IS NULL AND a.media_type = 'image'
    ) SELECT a.*, r.artist_id FROM ranked r JOIN assets a ON a.id = r.asset_id
      WHERE r.position <= 3 ORDER BY r.artist_id, r.position`).all() as Row[];
    const countByArtist = new Map(counts.map((row) => [row.artist_id, row]));
    const pagesByArtist = new Map(pages.map((row) => [row.artist_id, Number(row.book_page_count)]));
    const previewsByArtist = new Map<string | number | null | undefined, WorkAssetRecord[]>();
    for (const row of previews) {
      const current = previewsByArtist.get(row.artist_id) ?? [];
      current.push(assetRecord(row)); previewsByArtist.set(row.artist_id, current);
    }
    const result: ArtistSummary[] = artists.map((row) => {
      const id = String(row.id);
      const artist: ArtistRecord = { id, name: String(row.name), avatarUrl: nullableString(row.avatar_url), avatarLocalPath: nullableString(row.avatar_local_path), updatedAt: String(row.updated_at) };
      const count = countByArtist.get(id);
      return { key: `artist:${id}`, artistId: id, name: artist.name, artist,
        workCount: Number(count?.work_count ?? 0), pageCount: Number(count?.page_count ?? 0), bookPageCount: pagesByArtist.get(id) ?? 0,
        previewAssets: previewsByArtist.get(id) ?? [] };
    });
    const unknown = countByArtist.get(null);
    if (unknown) result.push({ key: "unknown-artist", artistId: null, name: "待补充作者信息", artist: null,
      workCount: Number(unknown.work_count), pageCount: Number(unknown.page_count), bookPageCount: pagesByArtist.get(null) ?? 0,
      previewAssets: previewsByArtist.get(null) ?? [] });
    return result;
  }

  querySavedViewSummaries(query: DirectoryPageQuery = {}): SavedViewSummaryResult {
    const offset = bounded(query.offset, 0, 0, 10_000_000), limit = bounded(query.limit, 12, 1, 12);
    const total = Number((this.database.prepare("SELECT COUNT(*) AS total FROM saved_collection_views").get() as { total: number }).total);
    const rows = this.database.prepare("SELECT id, name, query_json, created_at, updated_at FROM saved_collection_views ORDER BY created_at DESC, id LIMIT ? OFFSET ?")
      .all(limit, offset) as Array<{ id: string; name: string; query_json: string; created_at: string; updated_at: string }>;
    const existing = new Set((this.database.prepare("SELECT id FROM collections").all() as Array<{ id: string }>).map((row) => row.id));
    const items = rows.map((row) => {
      const view = mapSavedCollectionView(row);
      const includedCollectionIds = view.includedCollectionIds.filter((id) => existing.has(id));
      const excludedCollectionIds = view.excludedCollectionIds.filter((id) => existing.has(id));
      const matches = this.queryWorkPage({ collectionIds: includedCollectionIds, collectionMatchMode: view.matchMode, excludedCollectionIds, limit: 4 });
      return { ...view, effectiveQuery: { matchMode: view.matchMode, includedCollectionIds, excludedCollectionIds },
        missingIncludedIds: view.includedCollectionIds.filter((id) => !existing.has(id)),
        missingExcludedIds: view.excludedCollectionIds.filter((id) => !existing.has(id)),
        workCount: matches.total, pageCount: matches.totalPages,
        previewAssets: matches.items.flatMap((work) => work.coverAsset ? [work.coverAsset] : []) };
    });
    return { items, total, offset, limit, hasMore: offset + items.length < total };
  }

  listScopedArtworks(scope: GalleryScope): ScopedArtworkRecord[] {
    let condition: string, from = pageFrom, parameters: string[] = [];
    if (scope.kind === "collection") {
      // Start with the selected relation: an album with 20 pages must not scan every local page.
      from = `FROM collection_artworks member CROSS JOIN artworks aw ON aw.id = member.artwork_id
        JOIN assets a ON a.legacy_artwork_id = aw.id JOIN works w ON w.id = a.work_id`;
      requireId(scope.collectionId); condition = "member.collection_id = ?";
      parameters = [scope.collectionId];
    } else if (scope.kind === "artist") {
      if (scope.artistId === null) condition = "w.artist_id IS NULL";
      else { requireId(scope.artistId); condition = "w.artist_id = ?"; parameters = [scope.artistId]; }
    } else if (scope.kind === "work") {
      requireId(scope.workId); condition = "w.id = ?"; parameters = [scope.workId];
    } else throw new Error("Invalid gallery scope");
    return (this.database.prepare(`${pageSelect} ${from} WHERE ${validPage} AND ${condition} ORDER BY ${pageOrder}`).all(...parameters) as Row[]).map(pageRecord);
  }

  queryArtworkPages(query: ArtworkPageQuery = {}): ArtworkPageQueryResult {
    const offset = bounded(query.offset, 0, 0, 10_000_000), limit = bounded(query.limit, 60, 1, 200);
    const clauses = [availablePage], parameters: string[] = [];
    const search = typeof query.search === "string" ? query.search.trim().slice(0, 200) : "";
    if (search) {
      clauses.push("(instr(lower(w.title),lower(?)) > 0 OR instr(lower(COALESCE(ar.name,'')),lower(?)) > 0 OR instr(lower(aw.file_name),lower(?)) > 0 OR instr(lower(COALESCE(w.source_work_id,'')),lower(?)) > 0)");
      parameters.push(search, search, search, search);
    }
    if (query.excludedCollectionId) {
      requireId(query.excludedCollectionId);
      clauses.push("NOT EXISTS(SELECT 1 FROM collection_artworks ca WHERE ca.artwork_id = aw.id AND ca.collection_id = ?)");
      parameters.push(query.excludedCollectionId);
    }
    const where = clauses.join(" AND ");
    const artistJoin = search ? "LEFT JOIN artists ar ON ar.id = w.artist_id" : "";
    const total = Number((this.database.prepare(`SELECT COUNT(*) AS total ${pageFrom} ${artistJoin} WHERE ${where}`).get(...parameters) as { total: number }).total);
    // Keep index order and materialize IDs first. JSON and collection hydration only touch this page.
    const items = (this.database.prepare(`WITH selected AS MATERIALIZED (
      SELECT aw.id FROM artworks aw CROSS JOIN assets a ON a.legacy_artwork_id = aw.id
      JOIN works w ON w.id = a.work_id ${artistJoin} WHERE ${where}
      ORDER BY ${pageOrder} LIMIT ? OFFSET ?
    ) ${pageSelect} FROM selected selected_page JOIN artworks aw ON aw.id = selected_page.id
      JOIN assets a ON a.legacy_artwork_id = aw.id JOIN works w ON w.id = a.work_id ORDER BY ${pageOrder}`)
      .all(...parameters, limit, offset) as Row[]).map(pageRecord);
    return { items, total, offset, limit, hasMore: offset + items.length < total };
  }

  hasCollectionArtwork(collectionId: string, artworkId: string): boolean {
    return Boolean(this.database.prepare(`SELECT 1 ${pageFrom} JOIN collection_artworks ca ON ca.artwork_id = aw.id
      WHERE ${validPage} AND ca.collection_id = ? AND aw.id = ?`).get(collectionId, artworkId));
  }

  addArtworksToCollection(artworkIds: readonly string[], collectionId: string): number {
    requireId(collectionId);
    if (!Array.isArray(artworkIds) || artworkIds.length === 0 || artworkIds.length > 500) throw new Error("Select 1 to 500 artwork pages");
    for (const id of artworkIds) requireId(id);
    const ids = [...new Set(artworkIds)];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (!this.database.prepare("SELECT 1 FROM collections WHERE id = ?").get(collectionId)) throw new Error("Collection does not exist");
      const rows = this.database.prepare(`SELECT aw.id, a.work_id ${pageFrom} WHERE ${availablePage} AND aw.id IN (${ids.map(() => "?").join(", ")})`)
        .all(...ids) as Array<{ id: string; work_id: string }>;
      if (rows.length !== ids.length) throw new Error("One or more artwork pages are unavailable");
      const insertPage = this.database.prepare("INSERT OR IGNORE INTO collection_artworks (collection_id, artwork_id) VALUES (?, ?)");
      const insertWork = this.database.prepare("INSERT OR IGNORE INTO collection_works (collection_id, work_id, added_at) VALUES (?, ?, ?)");
      const now = new Date().toISOString(); let changed = 0;
      for (const row of rows) {
        changed += Number(insertPage.run(collectionId, row.id).changes);
        insertWork.run(collectionId, row.work_id, now);
      }
      this.database.exec("COMMIT"); return changed;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function requireId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,299}$/.test(id)) throw new Error("Invalid library id");
}
function nullableString(value: string | number | null | undefined): string | null { return value == null ? null : String(value); }
function assetRecord(row: Row): WorkAssetRecord {
  const numberOrNull = (value: string | number | null | undefined) => value == null ? null : Number(value);
  return { id: String(row.id), workId: String(row.work_id), legacyArtworkId: nullableString(row.legacy_artwork_id), pageIndex: Number(row.page_index),
    path: String(row.path), mediaType: row.media_type as WorkAssetRecord["mediaType"], extension: nullableString(row.extension),
    width: numberOrNull(row.width), height: numberOrNull(row.height), byteLength: numberOrNull(row.byte_length), contentHash: nullableString(row.content_hash),
    thumbnailPath: nullableString(row.thumbnail_path), fileState: row.file_state as WorkAssetRecord["fileState"], createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function pageRecord(row: Row): ScopedArtworkRecord {
  const parse = <T>(value: string | number | null | undefined): T | null => typeof value === "string" && value ? JSON.parse(value) as T : null;
  const source = row.source_platform === "pixiv" && row.source_work_id && row.source_page_index != null && row.author_id && row.author_name && row.work_title
    ? { platform: "pixiv" as const, workId: String(row.source_work_id), pageIndex: Number(row.source_page_index), authorId: String(row.author_id), authorName: String(row.author_name), title: String(row.work_title) } : null;
  return { id: String(row.id), path: String(row.path), fileName: String(row.file_name), importedAt: String(row.imported_at),
    ...(row.display_name ? { displayName: String(row.display_name) } : {}),
    assessment: parse<VisionAssessment>(row.assessment_json), decision: parse<FilterDecision>(row.decision_json), source,
    collectionIds: typeof row.collection_ids === "string" ? row.collection_ids.split("\u001f") : [], libraryWorkId: String(row.library_work_id),
    assetId: String(row.asset_id), pageIndex: Number(row.asset_page_index), thumbnailPath: nullableString(row.thumbnail_path) };
}
