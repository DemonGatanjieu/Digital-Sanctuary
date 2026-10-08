import { describe, expect, it } from "vitest";
import { LibraryDatabase } from "@sanctuary/database";
import { SavedWorkFilterStore } from "./saved-work-filter-ipc";
import { savedFilterQuery } from "../shared/saved-work-filter";

describe("saved work filter conditions", () => {
  it("restores ownership conditions without converting external references to managed files", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      const artwork = database.importArtwork("E:/fixtures/reference.png");
      const store = new SavedWorkFilterStore(database);
      const saved = store.create({ name: "外部素材", query: { ownership: "external" } });
      expect(new SavedWorkFilterStore(database).list()[0]!.query).toMatchObject({ ownership: "external" });
      expect(database.queryWorks(saved.query).items[0]!.id).toBe(`local:${artwork.id}`);
      expect(database.queryWorks({ ownership: "managed" }).total).toBe(0);
    } finally { database.close(); }
  });
  it("preserves real query conditions and order while excluding pagination and arbitrary fields", () => {
    expect(savedFilterQuery({ search: "  背景 ", favorite: true, viewedOnly: true, artistId: "artist", workType: "manga",
      collectionIds: ["a", "b", "a"], excludedCollectionIds: ["c"], collectionMatchMode: "all", sortBy: "title", direction: "asc",
      offset: 500, limit: 200, path: "E:/untrusted", sql: "DROP TABLE works" })).toEqual({ search: "背景", favorite: true, viewedOnly: true, artistId: "artist", workType: "manga",
      collectionIds: ["a", "b"], excludedCollectionIds: ["c"], collectionMatchMode: "all", sortBy: "title", direction: "asc" });
  });
  it("stores conditions, updates results with the library, and never creates an album", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      const store = new SavedWorkFilterStore(database);
      const saved = store.create({ name: "常用参考", query: { search: "background", workType: "local", sortBy: "title", direction: "asc" } });
      expect(database.queryWorks(saved.query).total).toBe(0);
      database.importArtwork("E:/fixtures/background.png");
      expect(database.queryWorks(saved.query).total).toBe(1);
      expect(new SavedWorkFilterStore(database).list()).toEqual([saved]);
      expect(database.listCollections()).toEqual([]);
      expect(store.delete(saved.id)).toBe(true); expect(store.delete(saved.id)).toBe(false);
      expect(database.queryWorks(saved.query).total).toBe(1);
    } finally { database.close(); }
  });
  it("keeps missing album IDs rather than silently broadening a saved filter", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      database.importArtwork("E:/fixtures/one.png");
      const store = new SavedWorkFilterStore(database);
      const saved = store.create({ name: "旧相册", query: { collectionId: "removed" } });
      expect(store.list()[0]!.query.collectionId).toBe("removed");
      expect(database.queryWorks(saved.query).total).toBe(0);
    } finally { database.close(); }
  });
  it("bounds storage, rejects duplicate names and ignores malformed stored records", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      const store = new SavedWorkFilterStore(database);
      expect(() => store.create({ name: "", query: {} })).toThrow();
      store.create({ name: "one", query: {} });
      expect(() => store.create({ name: " one ", query: {} })).toThrow("已存在");
      for (let index = 1; index < 30; index++) store.create({ name: String(index), query: {} });
      expect(() => store.create({ name: "31", query: {} })).toThrow("30");
      const entries = store.list();
      database.setPreference("library.savedWorkFilters.v1", [entries[0], entries[0], { name: "bad" }, { ...entries[1], createdAt: "invalid" }]);
      expect(store.list()).toEqual([entries[0]]);
    } finally { database.close(); }
  });
});
