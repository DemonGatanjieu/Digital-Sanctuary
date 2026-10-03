import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildElementFilterRules, type FilterRule } from "@sanctuary/domain";
import { LibraryDatabase } from "./index.js";

let fixtureId = 0;
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function analyzed(database: LibraryDatabase, labels: Record<string, number>, engineVersion = "1") {
  const directory = mkdtempSync(join(tmpdir(), "sanctuary-triage-"));
  directories.push(directory);
  const path = join(directory, ++fixtureId + ".png");
  writeFileSync(path, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  database.importArtwork(path);
  const work = database.listWorks().find((item) => !database.getCachedAssetAnalysis(item.assets[0]!.id, item.assets[0]!.updatedAt, "test"))!;
  const job = database.createAnalysisJob({ type: "selected", workIds: [work.id] }, "test");
  const item = database.claimNextAnalysisItem(job.id)!;
  database.completeAnalysisItem(item, { status: "complete", engine: "test", engineVersion, labels, elapsedMs: 1 }, false);
  return work;
}

describe("triage using exploration rules", () => {
  it("respects disabled groups, independent thresholds, custom aliases and overlapping rules", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      const work = analyzed(database, { blood: 0.6, guro: 0.5, custom_alias: 0.75 });
      const trustedBefore = database.listArtworks();
      const rules = buildElementFilterRules([
        { groupId: "blood", enabled: false, minimumConfidence: 0.1 },
        { groupId: "guro", enabled: true, minimumConfidence: 0.8 }
      ], [{ id: "custom-target", name: "自定义", description: "", tags: ["target"], aliases: ["custom_alias"], action: "blur", defaultThreshold: 0.7 }]);
      const hits = database.queryWorksByFilterRules(rules, { type: "all" }, { engine: "test", engineVersion: "1" });
      expect(hits.map((item) => item.work.id)).toEqual([work.id]);
      expect(hits[0]?.matchedTags).toEqual([{ tag: "custom_alias", confidence: 0.75 }]);
      expect(database.queryWorksByFilterRules(rules.map((rule) => ({ ...rule, enabled: false })))).toEqual([]);
      const overlap: FilterRule[] = [0.7, 0.4].map((minimumConfidence) => ({ id: "overlap", name: "overlap", label: "guro", enabled: true, action: "hide", priority: 0, minimumConfidence }));
      expect(database.queryWorksByFilterRules(overlap)[0]?.matchedTags).toEqual([{ tag: "guro", confidence: 0.5 }]);
      expect(database.listArtworks()).toEqual(trustedBefore);
    } finally { database.close(); }
  });

  it("uses the current model and asset version and preserves all scope boundaries", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      const current = analyzed(database, { blood: 0.8 });
      const previous = analyzed(database, { blood: 0.9 }, "old");
      const rules = buildElementFilterRules();
      const identity = { engine: "test", engineVersion: "1" };
      expect(database.queryWorksByFilterRules(rules, { type: "all" }, identity).map((item) => item.work.id)).toEqual([current.id]);
      expect(database.previewAnalysisScope({ type: "all" }, "test", "1").cachedAssetCount).toBe(1);
      expect(database.getCachedAssetAnalysis(previous.assets[0]!.id, previous.assets[0]!.updatedAt, "test", "1")).toBeNull();
      expect(database.queryWorksByFilterRules(rules, { type: "selected", workIds: [previous.id] }, identity)).toEqual([]);
      const collection = database.createCollection("排查范围");
      expect(database.queryWorksByFilterRules(rules, { type: "collection", collectionId: collection.id }, identity)).toEqual([]);
      database.addWorkToCollection(current.id, collection.id);
      expect(database.queryWorksByFilterRules(rules, { type: "collection", collectionId: collection.id }, identity)).toHaveLength(1);
      expect(database.queryWorksByFilterRules(rules, { type: "artist", artistId: "unknown" }, identity)).toEqual([]);
      database.removeWorkFromIndex(current.id);
      expect(database.queryWorksByFilterRules(rules, { type: "all" }, identity)).toEqual([]);
    } finally { database.close(); }
  });
});
