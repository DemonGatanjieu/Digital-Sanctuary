import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryDatabase } from "@sanctuary/database";
import { migrateStorageFiles } from "./storage-migration";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sanctuary-safe-migration-"));
  const source = join(root, "old", "Pixiv"), target = join(root, "new", "Pixiv"), backups = join(root, "Backups");
  mkdirSync(join(source, "1001"), { recursive: true });
  const path = join(source, "1001", "1001_p0.png"); writeFileSync(path, "original image");
  const db = new LibraryDatabase(join(root, "library.db"));
  cleanup.push(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  const art = db.importArtwork(path);
  return { root, source, target, backups, path, db, art, run: () => migrateStorageFiles(db, source, target, backups) };
}
describe("verified non-destructive legacy storage migration", () => {
  it("preserves old flat work folders, metadata, originals and unrelated files", async () => {
    const f = fixture();
    const collection = f.db.createCollection("旧相册", ""); f.db.addArtworkToCollection(f.art.id, collection.id);
    const workId = f.db.queryWorks({}).items[0]!.id; f.db.updateWorkFavorite([workId], true);
    writeFileSync(join(f.source, "私人笔记.txt"), "unrelated");
    const generated = join(f.root, "old", "Generated", "ComfyUI"); mkdirSync(generated, { recursive: true });
    const generatedPath = join(generated, "generated.png"); writeFileSync(generatedPath, "generated"); f.db.importArtwork(generatedPath);
    const result = await f.run();
    expect(result.migratedAssets).toBe(1);
    expect(readFileSync(f.path, "utf8")).toBe("original image");
    expect(readFileSync(join(f.target, "1001", "1001_p0.png"), "utf8")).toBe("original image");
    expect(f.db.listArtworks().find((a) => a.id === f.art.id)?.path).toContain(f.target);
    expect(f.db.queryWorks({ favorite: true }).total).toBe(1);
    expect(f.db.listArtworks().find((a) => a.path === generatedPath)).toBeDefined();
    expect(readdirSync(f.target)).toEqual(["1001"]);
    expect(readdirSync(f.backups).some((name) => name.startsWith("library.pre-storage-"))).toBe(true);
    expect(f.db.queryWorks({ collectionIds: [collection.id] }).total).toBe(1);
  });
  it("refuses different target content without overwriting or changing paths", async () => {
    const f = fixture(); mkdirSync(join(f.target, "1001"), { recursive: true });
    const destination = join(f.target, "1001", "1001_p0.png"); writeFileSync(destination, "different image");
    await expect(f.run()).rejects.toThrow("未覆盖");
    expect(readFileSync(destination, "utf8")).toBe("different image");
    expect(f.db.listArtworks()[0]?.path).toBe(f.path);
  });
  it("can retry and reuse an identical existing copy", async () => {
    const f = fixture(); mkdirSync(join(f.target, "1001"), { recursive: true });
    writeFileSync(join(f.target, "1001", "1001_p0.png"), "original image");
    expect((await f.run()).migratedAssets).toBe(1);
    expect((await f.run()).migratedAssets).toBe(0);
  });
  it("keeps the index and originals when one indexed file is missing", async () => {
    const f = fixture(); f.db.importArtwork(join(f.source, "missing.png"));
    await expect(f.run()).rejects.toThrow("找不到原文件");
    expect(f.db.listArtworks().find((a) => a.id === f.art.id)?.path).toBe(f.path);
    expect(readFileSync(f.path, "utf8")).toBe("original image");
  });
  it("rejects nesting before changing the library", async () => {
    const f = fixture();
    await expect(migrateStorageFiles(f.db, f.source, join(f.source, "nested"), f.backups)).rejects.toThrow("互相包含");
    await expect(migrateStorageFiles(f.db, f.source, join(f.root, "old"), f.backups)).rejects.toThrow("互相包含");
    expect(f.db.listArtworks()[0]?.path).toBe(f.path);
  });
  it("copies indexed avatars and preserves their originals", async () => {
    const f = fixture(), avatarRoot = join(f.root, "old", "avatars"); mkdirSync(avatarRoot);
    const avatar = join(avatarRoot, "7.jpg"); writeFileSync(avatar, "avatar");
    f.db.importArtist({ id: "7", name: "画师", avatarUrl: null, avatarLocalPath: avatar, updatedAt: new Date().toISOString() });
    expect((await f.run()).migratedAvatars).toBe(1);
    expect(f.db.listArtists()[0]?.avatarLocalPath).toBe(join(f.root, "new", "avatars", "7.jpg"));
    expect(readFileSync(avatar, "utf8")).toBe("avatar");
  });
  it("rolls back when another indexed source appears during the copy", async () => {
    const f = fixture(), commit = f.db.migrateArtworkStoragePaths.bind(f.db);
    vi.spyOn(f.db, "migrateArtworkStoragePaths").mockImplementation((source, target, verified) => {
      const another = join(f.source, "new.png"); writeFileSync(another, "new"); f.db.importArtwork(another);
      return commit(source, target, verified);
    });
    await expect(f.run()).rejects.toThrow("图库发生变化");
    expect(f.db.listArtworks().find((a) => a.id === f.art.id)?.path).toBe(f.path);
  });
  it("rejects target junctions without writing outside the selected folder", async () => {
    const f = fixture(), outside = join(f.root, "outside"); mkdirSync(outside); mkdirSync(f.target, { recursive: true });
    symlinkSync(outside, join(f.target, "1001"), "junction");
    await expect(f.run()).rejects.toThrow("包含链接");
    expect(existsSync(join(outside, "1001_p0.png"))).toBe(false);
    expect(f.db.listArtworks()[0]?.path).toBe(f.path);
  });
  it("rolls back all path changes when the target is already indexed separately", async () => {
    const f = fixture(), destination = join(f.target, "1001", "1001_p0.png"); mkdirSync(join(f.target, "1001"), { recursive: true });
    writeFileSync(destination, "original image"); f.db.importArtwork(destination);
    await expect(f.run()).rejects.toThrow();
    expect(f.db.listArtworks().map((a) => a.path).sort()).toEqual([f.path, destination].sort());
    expect(readFileSync(f.path, "utf8")).toBe("original image");
  });
});
