import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { LibraryDatabase } from "./index.js";
import type { WorkQuery } from "@sanctuary/domain";

describe("large library query boundary", () => {
  it("keeps a 10,000-work library paged and responsive", () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-10k-"));
    const path = join(directory, "library.db");
    const bootstrap = new LibraryDatabase(path);
    bootstrap.close();

    const fixture = new DatabaseSync(path);
    fixture.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;");
    const insertWork = fixture.prepare(
      `INSERT INTO works (
        id, source_platform, source_work_id, title, work_type, saved_at,
        favorite, page_count, ownership, created_at, updated_at
      ) VALUES (?, 'pixiv', ?, ?, 'illustration', ?, 0, 1, 'managed', ?, ?)`
    );
    const insertAsset = fixture.prepare(
      `INSERT INTO assets (
        id, work_id, page_index, path, media_type, extension, byte_length,
        thumbnail_path, file_state, created_at, updated_at
      ) VALUES (?, ?, 0, ?, 'image', '.jpg', 1048576, ?, 'available', ?, ?)`
    );
    const updateCover = fixture.prepare("UPDATE works SET cover_asset_id = ? WHERE id = ?");
    for (let index = 0; index < 10_000; index += 1) {
      const workId = `fixture-work-${index.toString().padStart(5, "0")}`;
      const assetId = `fixture-asset-${index.toString().padStart(5, "0")}`;
      const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      insertWork.run(workId, String(1_000_000 + index), `作品 ${index}`, timestamp, timestamp, timestamp);
      insertAsset.run(
        assetId,
        workId,
        `E:\\fixture\\${index}.jpg`,
        `E:\\fixture\\thumbs\\${index}.png`,
        timestamp,
        timestamp
      );
      updateCover.run(assetId, workId);
    }
    fixture.exec("COMMIT;");
    fixture.close();

    const database = new LibraryDatabase(path);
    try {
      const startedAt = performance.now();
      const firstPage = database.queryWorks({ limit: 60, sortBy: "savedAt", direction: "desc" });
      const lastPage = database.queryWorks({ limit: 60, offset: 9_940, sortBy: "savedAt", direction: "desc" });
      const elapsedMs = performance.now() - startedAt;

      expect(firstPage.total).toBe(10_000);
      expect(firstPage.items).toHaveLength(60);
      expect(firstPage.hasMore).toBe(true);
      expect(lastPage.items).toHaveLength(60);
      expect(lastPage.hasMore).toBe(false);
      expect(elapsedMs).toBeLessThan(2_000);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("preserves null placement, case-insensitive ties, byte totals, and filtered pagination for every sort", () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-page-order-"));
    const path = join(directory, "library.db");
    const bootstrap = new LibraryDatabase(path);
    bootstrap.close();
    const fixture = new DatabaseSync(path);
    fixture.exec(`
      INSERT INTO artists (id, name, updated_at) VALUES ('a', 'Alpha', '2026-01-01'), ('b', 'beta', '2026-01-01');
      INSERT INTO collections (id, name, created_at) VALUES ('selected', 'Selected', '2026-01-01');
    `);
    const insert = fixture.prepare(`INSERT INTO works
      (id,artist_id,title,work_type,published_at,saved_at,page_count,ownership,created_at,updated_at,deleted_at)
      VALUES (?,?,?,'local',?,?,?,'external','2026-01-01','2026-01-01',?)`);
    const insertAsset = fixture.prepare(`INSERT INTO assets
      (id,work_id,page_index,path,media_type,byte_length,file_state,created_at,updated_at)
      VALUES (?,?,?,?,'image',?,'available','2026-01-01','2026-01-01')`);
    const titles = ["beta", "Alpha", "alpha", "汉字", "", "Gamma", "Deleted"];
    titles.forEach((title, index) => {
      const id = `work-${index}`;
      insert.run(id, ["a", "b", null][index % 3] ?? null, title, index % 2 ? null : "2026-02-01", index % 2 ? "2026-03-01" : "2026-01-01", index % 3, index === 6 ? "2026-04-01" : null);
      for (let page = 0; page < index % 3; page += 1) {
        insertAsset.run(`${id}-${page}`, id, page, `E:/fixture/${id}-${page}.png`, index % 2 ? null : 500 + index);
      }
      if (index % 2 === 0) fixture.prepare("INSERT INTO collection_works VALUES ('selected',?,'2026-01-01')").run(id);
    });
    const sorts: Record<NonNullable<WorkQuery["sortBy"]>, string> = {
      savedAt: "w.saved_at", publishedAt: "w.published_at", title: "w.title COLLATE NOCASE",
      artist: "ar.name COLLATE NOCASE", pageCount: "w.page_count", byteLength: "total_byte_length"
    };
    const database = new LibraryDatabase(path);
    try {
      for (const [sortBy, expression] of Object.entries(sorts)) {
        for (const direction of ["asc", "desc"] as const) {
          for (const filtered of [false, true]) {
            const expected = fixture.prepare(`SELECT w.id,
              (SELECT COALESCE(SUM(a.byte_length),0) FROM assets a WHERE a.work_id=w.id) AS total_byte_length
              FROM works w LEFT JOIN artists ar ON ar.id=w.artist_id
              WHERE w.deleted_at IS NULL ${filtered ? "AND EXISTS(SELECT 1 FROM collection_works cw WHERE cw.work_id=w.id AND cw.collection_id='selected')" : ""}
              ORDER BY (${expression} IS NULL) ASC, ${expression} ${direction}, w.id ASC`).all() as Array<{ id: string; total_byte_length: number }>;
            const query: WorkQuery = { sortBy: sortBy as NonNullable<WorkQuery["sortBy"]>, direction, limit: 2, ...(filtered ? { collectionId: "selected" } : {}) };
            const actual = Array.from({ length: Math.ceil(expected.length / 2) }, (_, page) => database.queryWorks({ ...query, offset: page * 2 })).flatMap((result) => result.items);
            expect(actual.map((item) => ({ id: item.id, total_byte_length: item.totalByteLength }))).toEqual(expected.map((row) => ({ ...row })));
          }
        }
      }
    } finally {
      database.close();
      fixture.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("adds indexed thumbnail and avatar lookups when opening an existing database", () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-path-index-"));
    const path = join(directory, "library.db");
    const bootstrap = new LibraryDatabase(path);
    const version = bootstrap.schemaVersion();
    bootstrap.close();
    const fixture = new DatabaseSync(path);
    fixture.exec("DROP INDEX idx_assets_thumbnail_path; DROP INDEX idx_artists_avatar_local_path; DROP INDEX idx_assets_pending_thumbnails; DROP INDEX idx_assets_cached_thumbnails;");
    fixture.close();
    const database = new LibraryDatabase(path);
    const inspect = new DatabaseSync(path);
    try {
      expect(database.schemaVersion()).toBe(version);
      const plan = (sql: string) => (inspect.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("E:/fixture/image.png") as Array<{ detail: string }>).map((row) => row.detail).join(" ");
      expect(plan("SELECT 1 FROM assets WHERE thumbnail_path = ?")).toContain("USING COVERING INDEX idx_assets_thumbnail_path");
      expect(plan("SELECT 1 FROM artists WHERE avatar_local_path = ?")).toContain("USING COVERING INDEX idx_artists_avatar_local_path");
      for (const [condition, index] of [["IS NULL", "idx_assets_pending_thumbnails"], ["IS NOT NULL", "idx_assets_cached_thumbnails"]]) {
        const queuePlan = (inspect.prepare(`EXPLAIN QUERY PLAN SELECT id, path, thumbnail_path FROM assets
          WHERE media_type = 'image' AND file_state = 'available' AND thumbnail_path ${condition}
          ORDER BY created_at, id LIMIT ?`).all(6) as Array<{ detail: string }>).map((row) => row.detail).join(" ");
        expect(queuePlan).toContain(`USING INDEX ${index}`);
        expect(queuePlan).not.toContain("TEMP B-TREE");
      }
      expect(database.hasArtworkPath("E:/fixture/image.png")).toBe(false);
      expect(database.hasAvatarPath("E:/fixture/image.png")).toBe(false);
    } finally {
      database.close();
      inspect.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
