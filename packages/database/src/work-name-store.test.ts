import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LibraryDatabase } from "./index.js";

describe("gallery display names", () => {
  it("persists names across restart, scope/picker queries and reimport without changing files or assets", () => {
    const root = mkdtempSync(join(tmpdir(), "sanctuary-name-"));
    const path = join(root, "original.png"), databasePath = join(root, "library.db");
    writeFileSync(path, "unchanged image fixture");
    let database = new LibraryDatabase(databasePath);
    try {
      const image = database.importArtwork(path), workId = `local:${image.id}`;
      const album = database.createCollection("命名测试");
      database.addArtworkToCollection(image.id, album.id);
      const before = database.getWork(workId)!;
      expect(database.renameWork(workId, "  雨夜 / 参考图  ").title).toBe("雨夜 / 参考图");
      expect(database.getWork(workId)!.assets).toEqual(before.assets);
      expect(database.getWork(workId)!.collectionIds).toEqual(before.collectionIds);
      expect(database.queryWorks({ search: "雨夜" }).items[0]!.title).toBe("雨夜 / 参考图");
      expect(database.queryArtworkPages({ search: "雨夜" }).items[0]!.displayName).toBe("雨夜 / 参考图");
      expect(database.listScopedArtworks({ kind: "collection", collectionId: album.id })[0]!.displayName).toBe("雨夜 / 参考图");
      expect(database.listArtworks()[0]).toMatchObject({ fileName: "original.png", path, displayName: "雨夜 / 参考图", source: null });
      database.importArtwork(path);
      database.close(); database = new LibraryDatabase(databasePath);
      expect(database.getWork(workId)!.title).toBe("雨夜 / 参考图");
      expect(readFileSync(path, "utf8")).toBe("unchanged image fixture");
    } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps a multipage Pixiv name when remote metadata is refreshed or another page is added", () => {
    const database = new LibraryDatabase(":memory:");
    const source = { platform: "pixiv" as const, workId: "987", authorId: "42", authorName: "Artist", title: "Original title" };
    try {
      for (let page = 0; page < 2; page++) {
        const image = database.importArtwork(`E:/fixture/987_p${page}.png`);
        database.saveArtworkSource(image.id, { ...source, pageIndex: page });
      }
      const before = database.getWork("pixiv:987")!;
      database.renameWork(before.id, "我的双页收藏");
      const third = database.importArtwork("E:/fixture/987_p2.png");
      database.saveArtworkSource(third.id, { ...source, pageIndex: 2, title: "Updated source title" });
      expect(database.getWork(before.id)!.title).toBe("我的双页收藏");
      expect(database.getWork(before.id)!.assets.slice(0, 2)).toEqual(before.assets);
      const pages = database.listScopedArtworks({ kind: "work", workId: before.id });
      expect(pages).toHaveLength(3);
      expect(pages.every((page) => page.displayName === "我的双页收藏")).toBe(true);
      expect(pages.find((page) => page.id === third.id)!.source!.title).toBe("Updated source title");
    } finally { database.close(); }
  });

  it("rejects invalid names and deleted works without changing the previous name", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      const image = database.importArtwork("E:/fixture/original.png"), id = `local:${image.id}`;
      for (const name of [" ", "x".repeat(201), "bad\nname", "bad\0name"]) expect(() => database.renameWork(id, name)).toThrow("名称");
      expect(database.getWork(id)!.title).toBe("original.png");
      database.removeWorkFromIndex(id);
      expect(() => database.renameWork(id, "新名字")).toThrow("移除");
    } finally { database.close(); }
  });

  it("adds the optional name to an existing v6 library without rewriting its titles", () => {
    const root = mkdtempSync(join(tmpdir(), "sanctuary-name-upgrade-")), path = join(root, "library.db");
    let database = new LibraryDatabase(path);
    try {
      const image = database.importArtwork(join(root, "old.png"));
      database.close();
      const legacy = new DatabaseSync(path);
      legacy.exec("ALTER TABLE works DROP COLUMN custom_title; DELETE FROM schema_migrations WHERE version = 7"); legacy.close();
      database = new LibraryDatabase(path);
      expect(database.schemaVersion()).toBe(8);
      expect(database.getWork(`local:${image.id}`)!.title).toBe("old.png");
      expect(database.listArtworks()[0]!.displayName).toBeUndefined();
    } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
