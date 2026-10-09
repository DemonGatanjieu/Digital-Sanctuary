import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ResolvedElementMatch, VisionAssessment } from "@sanctuary/domain";
import { LibraryDatabase } from "./index.js";

const ENGINE = "wd-swinv2-tagger-v3";
function assessment(labels: Record<string, number>, engine = ENGINE): VisionAssessment {
  return { status: "complete", engine, engineVersion: "v3", labels, elapsedMs: 1 };
}
function match(partial: Partial<ResolvedElementMatch>): ResolvedElementMatch {
  return { engine: ENGINE, include: [], exclude: [], anyOf: [], ...partial };
}
function tagged(database: LibraryDatabase, path: string, labels: Record<string, number> | null, source?: { workId: string; pageIndex: number }) {
  const image = database.importArtwork(path);
  if (source) database.saveArtworkSource(image.id, { platform: "pixiv", workId: source.workId, pageIndex: source.pageIndex, authorId: "1", authorName: "A", title: `作品 ${source.workId}` });
  if (labels) database.saveAssessment(image.id, assessment(labels), { action: "allow", reasons: [], decidedAt: new Date().toISOString() });
  return image;
}
const titles = (database: LibraryDatabase, elementMatch: ResolvedElementMatch) =>
  database.queryWorks({ elementMatch, sortBy: "title", direction: "asc" }).items.map((item) => item.title).sort();

describe("element tag index", () => {
  it("matches a work when any page has the tag, and excludes only fully tagged works", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      tagged(database, "E:/f/cat.png", { cat_ears: 0.9, solo: 0.8 });
      tagged(database, "E:/f/beach.png", { beach: 0.7, blood: 0.1 });
      tagged(database, "E:/f/unknown.png", null);
      // A two-page work where only the second page shows blood.
      tagged(database, "E:/f/100_p0.png", { solo: 0.9 }, { workId: "100", pageIndex: 0 });
      tagged(database, "E:/f/100_p1.png", { blood: 0.6 }, { workId: "100", pageIndex: 1 });

      expect(titles(database, match({ include: [{ tag: "cat_ears", minimum: 0.4 }] }))).toEqual(["cat.png"]);
      expect(titles(database, match({ include: [{ tag: "blood", minimum: 0.4 }] }))).toEqual(["作品 100"]);
      // Below the threshold does not count; below the index floor is not stored at all.
      expect(titles(database, match({ include: [{ tag: "blood", minimum: 0.05 }] }))).toEqual(["作品 100"]);
      // Unknown is not "absent": the untagged picture never passes an exclusion.
      expect(titles(database, match({ exclude: [{ tag: "blood", minimum: 0.4 }] }))).toEqual(["beach.png", "cat.png"]);
      expect(titles(database, match({ anyOf: [{ tag: "beach", minimum: 0.5 }, { tag: "cat_ears", minimum: 0.95 }] }))).toEqual(["beach.png"]);
      // Another engine's tags are ignored.
      expect(titles(database, match({ engine: "other", include: [{ tag: "cat_ears", minimum: 0.4 }] }))).toEqual([]);
      expect(database.elementCoverage(ENGINE)).toEqual({ totalAssets: 5, taggedAssets: 4 });
    } finally { database.close(); }
  });

  it("keeps removed works out of the coverage count", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      const image = tagged(database, "E:/f/cat.png", { cat_ears: 0.9 });
      expect(titles(database, match({ include: [{ tag: "cat_ears", minimum: 0.4 }] }))).toEqual(["cat.png"]);
      database.removeWorkFromIndex(`local:${image.id}`);
      expect(database.elementCoverage(ENGINE)).toEqual({ totalAssets: 0, taggedAssets: 0 });
    } finally { database.close(); }
  });

  it("backfills the index from results stored before it existed", () => {
    const root = mkdtempSync(join(tmpdir(), "sanctuary-tags-"));
    const path = join(root, "library.db");
    try {
      let database = new LibraryDatabase(path);
      tagged(database, "E:/f/cat.png", { cat_ears: 0.9 });
      database.close();
      const raw = new DatabaseSync(path);
      raw.exec("DELETE FROM asset_tags; DELETE FROM asset_tag_coverage; DELETE FROM schema_migrations WHERE version = 8;");
      raw.close();
      database = new LibraryDatabase(path);
      expect(titles(database, match({ include: [{ tag: "cat_ears", minimum: 0.4 }] }))).toEqual(["cat.png"]);
      database.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
