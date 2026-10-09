import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { ScopedArtworkRecord } from "@sanctuary/domain";
import { LibraryDatabase } from "./index.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sanctuary-directory-")), path = join(root, "library.db");
  const database = new LibraryDatabase(path), raw = new DatabaseSync(path);
  return { root, database, raw, close() { raw.close(); database.close(); rmSync(root, { recursive: true, force: true }); } };
}
function pixivPages(test: ReturnType<typeof fixture>, id = 42, pages = 2, artistId = "7"): ScopedArtworkRecord[] {
  for (let page = 0; page < pages; page += 1) {
    const path = join(test.root, `${id}_p${page}.png`); writeFileSync(path, "trusted");
    const record = test.database.importArtwork(path);
    test.database.saveArtworkSource(record.id, { platform: "pixiv", workId: String(id), pageIndex: page, authorId: artistId, authorName: "Fixture Artist", title: `Cloud ${id}` });
  }
  return test.database.listScopedArtworks({ kind: "work", workId: `pixiv:${id}` });
}

describe("gallery directory and scoped pages", () => {
  it("counts canonical works separately from selected album pages and honors the selected page cover", () => {
    const test = fixture();
    try {
      const pages = pixivPages(test), a = test.database.createCollection("A"), b = test.database.createCollection("B"), empty = test.database.createCollection("Empty");
      const p0 = pages.find((page) => page.pageIndex === 0)!, p1 = pages.find((page) => page.pageIndex === 1)!;
      test.database.addArtworksToCollection([p0.id], a.id);
      test.database.addArtworksToCollection([p1.id], b.id);
      test.database.updateCollectionCover(b.id, p1.id);
      const originalList = vi.spyOn(test.database, "listArtworks").mockImplementation(() => { throw new Error("Must not load entire library"); });
      const workQueries = vi.spyOn(test.database, "queryWorks").mockImplementation(() => { throw new Error("Must not query each card"); });
      const summaries = test.database.listCollectionSummaries();
      expect(summaries.find((item) => item.id === a.id)).toMatchObject({ workCount: 1, pageCount: 2, bookPageCount: 1, coverAsset: { id: p0.assetId } });
      expect(summaries.find((item) => item.id === b.id)).toMatchObject({ workCount: 1, pageCount: 2, bookPageCount: 1, coverAsset: { id: p1.assetId } });
      expect(summaries.find((item) => item.id === empty.id)).toMatchObject({ workCount: 0, pageCount: 0, bookPageCount: 0, coverAsset: null });
      expect(test.database.listScopedArtworks({ kind: "collection", collectionId: a.id }).map((page) => page.id)).toEqual([p0.id]);
      expect(test.database.hasCollectionArtwork(a.id, p0.id)).toBe(true);
      expect(test.database.hasCollectionArtwork(a.id, p1.id)).toBe(false);
      expect(originalList).not.toHaveBeenCalled(); expect(workQueries).not.toHaveBeenCalled();
    } finally { test.close(); }
  });

  it("keeps unknown local pages at real work IDs, groups known artists, and bounds previews", () => {
    const test = fixture();
    try {
      for (const id of [11, 12, 13, 14]) pixivPages(test, id, 2);
      test.database.importArtist({ id: "orphan", name: "No works", avatarUrl: null, avatarLocalPath: null, updatedAt: "2026-10-03" });
      for (const name of ["900_p0.jpg", "900_p1.jpg"]) {
        const path = join(test.root, name); writeFileSync(path, "trusted"); test.database.importArtwork(path);
      }
      vi.spyOn(test.database, "listArtworks").mockImplementation(() => { throw new Error("No full library"); });
      vi.spyOn(test.database, "queryWorks").mockImplementation(() => { throw new Error("No per-card work query"); });
      const artists = test.database.listArtistSummaries(), known = artists.find((artist) => artist.artistId === "7")!;
      expect(known).toMatchObject({ workCount: 4, pageCount: 8, bookPageCount: 8, artist: { id: "7" } });
      expect(known.previewAssets).toHaveLength(3);
      expect(new Set(known.previewAssets.map((asset) => asset.workId)).size).toBe(3);
      expect(artists.find((artist) => artist.artistId === "orphan")).toMatchObject({ workCount: 0, previewAssets: [] });
      expect(artists.find((artist) => artist.artistId === null)).toMatchObject({ workCount: 2, pageCount: 2, bookPageCount: 2, artist: null });
      const unknown = test.database.listScopedArtworks({ kind: "artist", artistId: null });
      expect(unknown).toHaveLength(2); expect(unknown.every((page) => page.libraryWorkId === `local:${page.id}`)).toBe(true);
      expect(new Set(unknown.map((page) => page.libraryWorkId)).size).toBe(2);
      expect(test.database.listScopedArtworks({ kind: "artist", artistId: "7" })).toHaveLength(8);
    } finally { test.close(); }
  });

  it("uses work-level saved-view conditions, normalizes deleted conditions, and pages at most 12 summaries", () => {
    const test = fixture();
    try {
      const pages = pixivPages(test), other = pixivPages(test, 99, 1), a = test.database.createCollection("A"), b = test.database.createCollection("B");
      test.database.addArtworksToCollection([pages[0]!.id], a.id); test.database.addArtworksToCollection([pages[1]!.id], b.id);
      const and = test.database.createSavedCollectionView({ name: "AND", matchMode: "all", includedCollectionIds: [a.id, b.id], excludedCollectionIds: [] });
      const or = test.database.createSavedCollectionView({ name: "OR", matchMode: "any", includedCollectionIds: [a.id, b.id], excludedCollectionIds: [] });
      const not = test.database.createSavedCollectionView({ name: "NOT", matchMode: "any", includedCollectionIds: [], excludedCollectionIds: [a.id] });
      const excluded = test.database.createSavedCollectionView({ name: "AND NOT", matchMode: "all", includedCollectionIds: [a.id], excludedCollectionIds: [b.id] });
      vi.spyOn(test.database, "listArtworks").mockImplementation(() => { throw new Error("No full library"); });
      const publicQuery = vi.spyOn(test.database, "queryWorks").mockImplementation(() => { throw new Error("Use shared internal query boundary"); });
      const summaries = test.database.querySavedViewSummaries().items;
      expect(summaries.find((item) => item.id === and.id)).toMatchObject({ workCount: 1, pageCount: 2 });
      expect(summaries.find((item) => item.id === or.id)?.workCount).toBe(1);
      expect(summaries.find((item) => item.id === not.id)).toMatchObject({ workCount: 1, pageCount: 1, previewAssets: [{ workId: other[0]!.libraryWorkId }] });
      expect(summaries.find((item) => item.id === excluded.id)?.workCount).toBe(0);
      expect(publicQuery).not.toHaveBeenCalled();
      test.database.deleteCollection(b.id);
      const normalized = test.database.querySavedViewSummaries().items.find((item) => item.id === and.id)!;
      expect(normalized).toMatchObject({ workCount: 1, missingIncludedIds: [b.id], effectiveQuery: { includedCollectionIds: [a.id] } });
      test.database.deleteCollection(a.id);
      expect(test.database.querySavedViewSummaries().items.find((item) => item.id === and.id)).toMatchObject({ workCount: 2, pageCount: 3 });
      for (let index = 0; index < 15; index += 1) test.database.createSavedCollectionView({ name: `View ${index}`, matchMode: "any", includedCollectionIds: ["deleted-id"], excludedCollectionIds: [] });
      const first = test.database.querySavedViewSummaries({ limit: 1000 }), second = test.database.querySavedViewSummaries({ offset: 12 });
      expect(first).toMatchObject({ total: 19, limit: 12, hasMore: true }); expect(first.items).toHaveLength(12);
      expect(second).toMatchObject({ total: 19, hasMore: false }); expect(second.items).toHaveLength(7);
      expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(19);
    } finally { test.close(); }
  });

  it("reads complete scoped pages, preserves analysis records, and paginates candidates by page membership", () => {
    const test = fixture();
    try {
      const pages = pixivPages(test, 42, 3), others = pixivPages(test, 99, 2), album = test.database.createCollection("Partial");
      test.database.addArtworksToCollection([pages[0]!.id], album.id);
      const assessment = { status: "complete" as const, engine: "fixture", engineVersion: "1", labels: { blood: .9 }, elapsedMs: 1 };
      test.database.saveAssessment(pages[1]!.id, assessment, { action: "hide", reasons: [], decidedAt: "2026-10-03" });
      const thumbnail = join(test.root, "thumbnail.png"); writeFileSync(thumbnail, "thumb"); test.database.updateAssetThumbnail(pages[1]!.assetId, thumbnail);
      vi.spyOn(test.database, "listArtworks").mockImplementation(() => { throw new Error("No full library"); });
      const scoped = test.database.listScopedArtworks({ kind: "work", workId: "pixiv:42" });
      expect(scoped).toHaveLength(3); expect(scoped.find((page) => page.id === pages[1]!.id)).toMatchObject({ assessment, thumbnailPath: thumbnail, libraryWorkId: "pixiv:42", assetId: pages[1]!.assetId, decision: { action: "hide" } });
      const first = test.database.queryArtworkPages({ search: "cLoUd", excludedCollectionId: album.id, limit: 2 }), second = test.database.queryArtworkPages({ search: "cLoUd", excludedCollectionId: album.id, limit: 2, offset: 2 });
      expect(first).toMatchObject({ total: 4, hasMore: true }); expect(second).toMatchObject({ total: 4, hasMore: false });
      expect(new Set([...first.items, ...second.items].map((page) => page.id)).size).toBe(4);
      expect([...first.items, ...second.items].some((page) => page.id === pages[0]!.id)).toBe(false);
      expect([...first.items, ...second.items].some((page) => page.id === pages[1]!.id)).toBe(true);
      expect(test.database.queryArtworkPages({ search: "Fixture Artist", limit: 999 }).limit).toBe(200);
      expect(test.database.queryArtworkPages({ search: "99" }).items.map((page) => page.libraryWorkId)).toEqual([others[0]!.libraryWorkId, others[0]!.libraryWorkId]);
    } finally { test.close(); }
  });

  it("validates a whole bounded bulk operation, rolls back mid-write failures and keeps duplicate inserts idempotent", () => {
    const test = fixture();
    try {
      const pages = pixivPages(test), album = test.database.createCollection("Bulk");
      expect(() => test.database.addArtworksToCollection([pages[0]!.id, "missing"], album.id)).toThrow("unavailable");
      expect(test.database.listScopedArtworks({ kind: "collection", collectionId: album.id })).toEqual([]);
      expect(() => test.database.addArtworksToCollection([pages[0]!.id], "missing")).toThrow("Collection does not exist");
      expect(() => test.database.addArtworksToCollection(Array(501).fill(pages[0]!.id), album.id)).toThrow("500");
      expect(() => test.database.addArtworksToCollection(["E:/private.png"], album.id)).toThrow("Invalid library id");
      test.raw.exec(`CREATE TRIGGER reject_page BEFORE INSERT ON collection_artworks WHEN NEW.artwork_id = '${pages[1]!.id}' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
      expect(() => test.database.addArtworksToCollection(pages.map((page) => page.id), album.id)).toThrow("fixture failure");
      expect(test.database.queryWorks({ collectionId: album.id }).total).toBe(0);
      expect(test.database.listScopedArtworks({ kind: "collection", collectionId: album.id })).toEqual([]);
      test.raw.exec("DROP TRIGGER reject_page;");
      expect(test.database.addArtworksToCollection([pages[0]!.id, pages[0]!.id, pages[1]!.id], album.id)).toBe(2);
      expect(test.database.addArtworksToCollection(pages.map((page) => page.id), album.id)).toBe(0);
      expect(test.database.listCollectionSummaries()[0]).toMatchObject({ workCount: 1, pageCount: 2, bookPageCount: 2 });
      expect(test.database.schemaVersion()).toBe(8);
    } finally { test.close(); }
  });

  it.each(["missing", "trashed", "error"] as const)("excludes %s candidates and rejects a mixed batch without losing indexed book pages", (state) => {
    const test = fixture();
    try {
      const pages = pixivPages(test), album = test.database.createCollection("Mixed batch"), inventory = test.database.createCollection("Indexed book");
      const available = pages[0]!, unavailable = pages[1]!;
      test.database.addArtworksToCollection(pages.map((page) => page.id), inventory.id);
      test.database.updateAssetFileState(unavailable.assetId, state);

      const candidates = test.database.queryArtworkPages({ excludedCollectionId: album.id });
      expect(candidates).toMatchObject({ total: 1, hasMore: false });
      expect(candidates.items.map((page) => page.id)).toEqual([available.id]);
      expect(test.database.queryArtworkPages({ search: "Cloud" }).items.map((page) => page.id)).toEqual([available.id]);
      expect(() => test.database.addArtworksToCollection([available.id, unavailable.id], album.id)).toThrow("unavailable");
      expect(test.database.listScopedArtworks({ kind: "collection", collectionId: album.id })).toEqual([]);
      expect(test.database.queryWorks({ collectionId: album.id }).total).toBe(0);

      // Existing memberships remain inventory records, including unavailable pages in their book manifest.
      test.database.addArtworksToCollection([available.id], album.id);
      expect(test.database.listScopedArtworks({ kind: "collection", collectionId: inventory.id })).toHaveLength(2);
      expect(test.database.listCollectionSummaries().find((item) => item.id === inventory.id)).toMatchObject({ workCount: 1, pageCount: 2, bookPageCount: 2 });
    } finally { test.close(); }
  });

  it("keeps the complete scoped book above the candidate limit and preserves stable tied-date pagination", () => {
    const test = fixture();
    try {
      const pages = pixivPages(test, 42, 205), album = test.database.createCollection("Long book");
      test.raw.prepare("UPDATE artworks SET imported_at = ?").run("2026-10-03T00:00:00.000Z");
      test.database.addArtworksToCollection(pages.map((page) => page.id), album.id);
      expect(test.database.listScopedArtworks({ kind: "collection", collectionId: album.id })).toHaveLength(205);
      const first = test.database.queryArtworkPages({ limit: 200 }), last = test.database.queryArtworkPages({ limit: 200, offset: 200 });
      expect(first).toMatchObject({ total: 205, hasMore: true }); expect(last).toMatchObject({ total: 205, hasMore: false });
      const ids = [...first.items, ...last.items].map((page) => page.id);
      expect(ids).toEqual(pages.map((page) => page.id).sort());
      expect(new Set(ids).size).toBe(205);
    } finally { test.close(); }
  }, 20_000); // Builds 205 real files; the default 5 s is too tight when the full suite runs in parallel.

  it("drops deleted scopes and stale covers, keeps metadata-only works, and makes unknown work queries exact", () => {
    const test = fixture();
    try {
      const first = pixivPages(test), second = pixivPages(test, 99), album = test.database.createCollection("Deleted cover");
      test.database.addArtworksToCollection([first[0]!.id, second[0]!.id], album.id); test.database.updateCollectionCover(album.id, first[0]!.id);
      test.database.removeWorkFromIndex("pixiv:42");
      expect(test.database.listCollectionSummaries()[0]).toMatchObject({ workCount: 1, pageCount: 2, bookPageCount: 1, coverAsset: { workId: "pixiv:99" } });
      expect(test.database.listScopedArtworks({ kind: "work", workId: "pixiv:42" })).toEqual([]);
      expect(test.database.hasCollectionArtwork(album.id, first[0]!.id)).toBe(false);
      test.database.seedBenchmarkWorks(1); const metadataAlbum = test.database.createCollection("Metadata"); test.database.addWorkToCollection("benchmark-work-0", metadataAlbum.id);
      expect(test.database.listCollectionSummaries().find((item) => item.id === metadataAlbum.id)).toMatchObject({ workCount: 1, pageCount: 1, bookPageCount: 0, coverAsset: null });
      expect(test.database.listScopedArtworks({ kind: "collection", collectionId: metadataAlbum.id })).toEqual([]);
      const localPath = join(test.root, "unknown.png"); writeFileSync(localPath, "trusted"); const local = test.database.importArtwork(localPath);
      expect(test.database.queryWorks({ unattributed: true }).items.map((work) => work.id)).toEqual([`local:${local.id}`]);
      expect(test.database.queryWorks({ unattributed: true, artistId: "7" }).total).toBe(0);
      expect(test.database.queryWorks({ unattributed: false }).total).toBe(3);
      test.raw.prepare("UPDATE works SET deleted_at = ? WHERE id = 'pixiv:99'").run("2026-10-03");
      expect(test.database.listScopedArtworks({ kind: "artist", artistId: "7" })).toEqual([]);
      expect(test.database.listCollectionSummaries().find((item) => item.id === album.id)).toMatchObject({ workCount: 0, bookPageCount: 0, coverAsset: null });
    } finally { test.close(); }
  });
});
