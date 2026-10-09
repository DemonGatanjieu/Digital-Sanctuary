import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { WorkReadingProgress, WorkRecord } from "@sanctuary/domain";
import { LibraryDatabase } from "./index.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sanctuary-reading-"));
  const path = join(root, "library.db");
  const database = new LibraryDatabase(path);
  return { root, path, database, close() { database.close(); vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); } };
}

function addWork(database: LibraryDatabase, root: string, index: number, pages = 1): WorkRecord {
  for (let page = 0; page < pages; page += 1) {
    const path = join(root, `${index}-p${page}.png`);
    writeFileSync(path, "trusted-fixture");
    const imported = database.importArtwork(path);
    database.saveArtworkSource(imported.id, {
      platform: "pixiv", workId: String(index), pageIndex: page,
      authorId: "reader-fixture", authorName: "Fixture Artist", title: `Reference ${index}`
    });
  }
  return database.getWork(`pixiv:${index}`)!;
}

describe("local reading progress", () => {
  it("records only view time and replaces the last page of a work without creating analysis", () => {
    const test = fixture();
    try {
      const work = addWork(test.database, test.root, 1, 2);
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-03T10:00:00.000Z"));
      const first = test.database.recordWorkView(work.id, work.assets[0]!.id);
      expect(first).toEqual({ workId: work.id, assetId: work.assets[0]!.id, viewedAt: "2026-10-03T10:00:00.000Z" });
      vi.setSystemTime(new Date("2026-10-03T10:01:00.000Z"));
      const second = test.database.recordWorkView(work.id, work.assets[1]!.id);
      expect(test.database.getWork(work.id)).toMatchObject({ readingProgress: second, lastViewedAt: second!.viewedAt, savedAt: work.savedAt, updatedAt: work.updatedAt });
      expect(test.database.getPreference("library.readingProgress")).toEqual([second]);
      expect(test.database.queryWorks({ viewedOnly: true }).items[0]?.lastViewedAt).toBe(second!.viewedAt);
      expect(test.database.listAnalysisJobs()).toEqual([]);
      expect(test.database.schemaVersion()).toBe(8);
    } finally { test.close(); }
  });

  it("rejects wrong-work, missing, unavailable and non-image assets without changing existing progress", () => {
    const test = fixture();
    const raw = new DatabaseSync(test.path);
    try {
      const work = addWork(test.database, test.root, 1, 2);
      const other = addWork(test.database, test.root, 2);
      const original = test.database.recordWorkView(work.id, work.assets[0]!.id)!;
      const before = test.database.getPreference("library.readingProgress");
      expect(test.database.recordWorkView(work.id, other.assets[0]!.id)).toBeNull();
      expect(test.database.recordWorkView(work.id, "asset-does-not-exist")).toBeNull();
      expect(test.database.recordWorkView("work-does-not-exist", work.assets[0]!.id)).toBeNull();
      raw.prepare("UPDATE assets SET media_type = 'ugoira' WHERE id = ?").run(work.assets[1]!.id);
      expect(test.database.recordWorkView(work.id, work.assets[1]!.id)).toBeNull();
      expect(test.database.getPreference("library.readingProgress")).toEqual(before);
      expect(test.database.getWork(work.id)?.lastViewedAt).toBe(original.viewedAt);
      test.database.updateAssetFileState(work.assets[0]!.id, "missing");
      expect(test.database.recordWorkView(work.id, work.assets[0]!.id)).toBeNull();
      expect(test.database.getWork(work.id)?.readingProgress).toBeUndefined();
      expect(test.database.getPreference("library.readingProgress")).toEqual([]);
    } finally { raw.close(); test.close(); }
  });

  it("retains at most 100 unique works and cleans progress when works are removed", () => {
    const test = fixture();
    try {
      vi.useFakeTimers();
      const works: WorkRecord[] = [];
      for (let index = 0; index < 105; index += 1) {
        vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 10, 0, index)));
        const work = addWork(test.database, test.root, index);
        works.push(work);
        test.database.recordWorkView(work.id, work.assets[0]!.id);
      }
      const history = test.database.getPreference<WorkReadingProgress[]>("library.readingProgress")!;
      expect(history).toHaveLength(100);
      expect(new Set(history.map((entry) => entry.workId)).size).toBe(100);
      expect(history[0]?.workId).toBe("pixiv:104");
      expect(history.some((entry) => entry.workId === "pixiv:0")).toBe(false);
      expect(test.database.getWork("pixiv:0")?.readingProgress).toBeUndefined();
      expect(test.database.removeWorkFromIndex(works[104]!.id)).toBe(true);
      expect(test.database.getPreference<WorkReadingProgress[]>("library.readingProgress")!.some((entry) => entry.workId === "pixiv:104")).toBe(false);
      expect(test.database.getWork("pixiv:104")).toBeNull();
    } finally { test.close(); }
  });

  it("normalizes bounded stored history, discards wrong assets and deletes soft-deleted progress", () => {
    const test = fixture();
    const raw = new DatabaseSync(test.path);
    try {
      const work = addWork(test.database, test.root, 1, 2);
      const other = addWork(test.database, test.root, 2);
      const valid = { workId: work.id, assetId: work.assets[1]!.id, viewedAt: "2026-10-03T10:02:00.000Z" };
      test.database.setPreference("library.readingProgress", [
        { ...valid, assetId: other.assets[0]!.id }, null, { ...valid, assetId: work.assets[0]!.id, viewedAt: "bad-date" },
        valid, { ...valid, assetId: work.assets[0]!.id, viewedAt: "2026-10-03T10:01:00.000Z" },
        { workId: other.id, assetId: other.assets[0]!.id, viewedAt: "2026-10-03T10:00:00.000Z", path: "E:/private.png" }
      ]);
      expect(test.database.getWork(work.id)?.readingProgress).toEqual(valid);
      expect(test.database.getPreference<WorkReadingProgress[]>("library.readingProgress")).toHaveLength(2);
      expect(JSON.stringify(test.database.getPreference("library.readingProgress"))).not.toContain("private.png");
      raw.prepare("UPDATE works SET deleted_at = ? WHERE id = ?").run("2026-10-03T10:03:00.000Z", work.id);
      expect(test.database.getWork(work.id)).toBeNull();
      expect(test.database.recordWorkView(work.id, work.assets[0]!.id)).toBeNull();
      expect(test.database.getPreference<WorkReadingProgress[]>("library.readingProgress")).toHaveLength(1);
      raw.prepare("UPDATE user_preferences SET value_json = 'broken json' WHERE key = 'library.readingProgress'").run();
      expect(test.database.getWork(other.id)?.readingProgress).toBeUndefined();
      expect(test.database.getPreference("library.readingProgress")).toEqual([]);
    } finally { raw.close(); test.close(); }
  });
});

describe("everyday work filters", () => {
  it("combines favorites, uncollected and viewed filters with search, collections, accurate totals and pagination", () => {
    const test = fixture();
    const raw = new DatabaseSync(test.path);
    try {
      const works = [addWork(test.database, test.root, 101, 2), addWork(test.database, test.root, 102), addWork(test.database, test.root, 103, 3), addWork(test.database, test.root, 104), addWork(test.database, test.root, 105, 2), addWork(test.database, test.root, 106), addWork(test.database, test.root, 107)];
      test.database.updateWorkFavorite(["pixiv:101", "pixiv:102", "pixiv:104", "pixiv:107"], true);
      const albumA = test.database.createCollection("A"), albumB = test.database.createCollection("B");
      test.database.addWorkToCollection("pixiv:102", albumA.id);
      test.database.addWorkToCollection("pixiv:104", albumB.id);
      test.database.addWorkToCollection("pixiv:106", albumA.id);
      test.database.addWorkToCollection("pixiv:106", albumB.id);
      vi.useFakeTimers();
      for (const [index, workId] of ["pixiv:101", "pixiv:102", "pixiv:103", "pixiv:106", "pixiv:107"].entries()) {
        vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 10, 0, index)));
        const work = works.find((candidate) => candidate.id === workId)!;
        test.database.recordWorkView(workId, work.assets[0]!.id);
      }
      raw.prepare("UPDATE works SET deleted_at = ? WHERE id = 'pixiv:107'").run("2026-10-03T11:00:00.000Z");
      raw.prepare("UPDATE works SET saved_at = ? WHERE id = 'pixiv:101'").run("2099-01-01T00:00:00.000Z");
      expect(test.database.queryWorks({ favorite: true })).toMatchObject({ total: 3, totalPages: 4 });
      expect(test.database.queryWorks({ favorite: false })).toMatchObject({ total: 3, totalPages: 6 });
      expect(test.database.queryWorks({ uncollected: true })).toMatchObject({ total: 3, totalPages: 7 });
      expect(test.database.queryWorks({ favorite: true, uncollected: true, viewedOnly: true }).items.map((work) => work.id)).toEqual(["pixiv:101"]);
      expect(test.database.queryWorks({ uncollected: true, collectionId: albumA.id }).total).toBe(0);
      expect(test.database.queryWorks({ favorite: false, viewedOnly: true, collectionIds: [albumA.id, albumB.id], collectionMatchMode: "all" }).items.map((work) => work.id)).toEqual(["pixiv:106"]);
      expect(test.database.queryWorks({ viewedOnly: true, excludedCollectionIds: [albumA.id], search: "Reference", artistId: "reader-fixture", workType: "unknown" })).toMatchObject({ total: 2, totalPages: 5 });
      expect(test.database.queryWorks({ uncollected: false, viewedOnly: false }).total).toBe(6);
      const first = test.database.queryWorks({ viewedOnly: true, sortBy: "lastViewedAt", limit: 2 });
      const second = test.database.queryWorks({ viewedOnly: true, sortBy: "lastViewedAt", limit: 2, offset: 2 });
      expect(first).toMatchObject({ total: 4, totalPages: 7, hasMore: true });
      expect(second).toMatchObject({ total: 4, totalPages: 7, hasMore: false });
      expect([...first.items, ...second.items].map((work) => work.id)).toEqual(["pixiv:106", "pixiv:103", "pixiv:102", "pixiv:101"]);
      for (const direction of ["asc", "desc"] as const) {
        const result = test.database.queryWorks({ sortBy: "lastViewedAt", direction });
        expect(result.items.slice(-2).map((work) => work.id)).toEqual(["pixiv:104", "pixiv:105"]);
        expect(result.items.slice(0, 4).map((work) => work.id)).toEqual(direction === "desc" ? ["pixiv:106", "pixiv:103", "pixiv:102", "pixiv:101"] : ["pixiv:101", "pixiv:102", "pixiv:103", "pixiv:106"]);
      }
      const plan = (raw.prepare("EXPLAIN QUERY PLAN SELECT id FROM works WHERE deleted_at IS NULL AND last_viewed_at IS NOT NULL ORDER BY last_viewed_at DESC, id LIMIT 60").all() as Array<{ detail: string }>).map((row) => row.detail).join(" ");
      expect(plan).toContain("USING INDEX idx_works_last_viewed_at");
      expect(plan).not.toContain("TEMP B-TREE");
    } finally { raw.close(); test.close(); }
  });
});
