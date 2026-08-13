import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { LibraryDatabase } from "./index.js";

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
});
