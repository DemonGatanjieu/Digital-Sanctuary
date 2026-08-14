import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { SavedCollectionViewStore } from "./saved-collection-view-store.js";

function createStore(): { database: DatabaseSync; store: SavedCollectionViewStore } {
  const database = new DatabaseSync(":memory:");
  const store = new SavedCollectionViewStore(database);
  store.ensureSchema();
  return { database, store };
}

describe("SavedCollectionViewStore", () => {
  it("normalizes conditions and enforces case-insensitive names in SQLite", () => {
    const { database, store } = createStore();
    try {
      const created = store.create({
        name: "  References  ",
        matchMode: "all",
        includedCollectionIds: ["a", "a", "b"],
        excludedCollectionIds: ["b", "c"]
      });
      expect(created).toMatchObject({
        name: "References",
        includedCollectionIds: ["a", "b"],
        excludedCollectionIds: ["c"]
      });
      expect(() => store.create({
        name: "references",
        matchMode: "any",
        includedCollectionIds: ["a"],
        excludedCollectionIds: []
      })).toThrow('Saved collection view "references" already exists');
    } finally {
      database.close();
    }
  });

  it("rejects empty and oversized persisted conditions", () => {
    const { database, store } = createStore();
    try {
      expect(() => store.create({
        name: "Empty",
        matchMode: "any",
        includedCollectionIds: [],
        excludedCollectionIds: []
      })).toThrow("requires at least one collection condition");
      expect(() => store.create({
        name: "Too many",
        matchMode: "any",
        includedCollectionIds: Array.from({ length: 51 }, (_, index) => String(index)),
        excludedCollectionIds: []
      })).toThrow("cannot reference more than 50 collections");
      expect(() => store.create({
        name: "Invalid mode",
        matchMode: "none",
        includedCollectionIds: ["a"],
        excludedCollectionIds: []
      } as never)).toThrow("match mode must be all or any");
    } finally {
      database.close();
    }
  });

  it("reads damaged legacy JSON fail-soft without exposing malformed IDs", () => {
    const { database, store } = createStore();
    try {
      database.prepare(
        "INSERT INTO saved_collection_views (id, name, query_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      ).run("broken", "Broken", '{"matchMode":"all","includedCollectionIds":["valid",42]}', "now", "now");
      database.prepare(
        "INSERT INTO saved_collection_views (id, name, query_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      ).run("invalid-json", "Invalid JSON", "{", "now", "now");

      expect(store.get("broken")).toMatchObject({
        matchMode: "all",
        includedCollectionIds: ["valid"],
        excludedCollectionIds: []
      });
      expect(store.get("invalid-json")).toMatchObject({
        matchMode: "any",
        includedCollectionIds: [],
        excludedCollectionIds: []
      });
    } finally {
      database.close();
    }
  });
});
