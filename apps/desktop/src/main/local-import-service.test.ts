import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryDatabase } from "@sanctuary/database";
import { LocalImportService, fingerprintImage, parseImportOptions } from "./local-import-service";
import type { LocalImportBatch } from "@sanctuary/domain";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "sanctuary-import-test-"));
  const database = new LibraryDatabase(":memory:");
  cleanups.push(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
  const image = (name: string, content: Buffer | string = png) => { const path = join(directory, name); writeFileSync(path, content); return path; };
  return { database, image, service: new LocalImportService(database) };
}
async function finish(service: LocalImportService, batch: LocalImportBatch) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = service.get(1, batch.id);
    if (result.phase !== "running") return result;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error("import did not finish");
}
describe("native-picker local import", () => {
  it("archives new images, reuses exact content, and leaves external files unchanged", async () => {
    const { image, database, service } = fixture();
    const first = image("first.png"); const second = image("second.png");
    const album = database.createCollection("参考");
    const batch = service.choose(1, [first, second])!;
    expect(batch.phase).toBe("ready"); expect(database.listWorks()).toHaveLength(0);
    const result = await finish(service, service.start(1, batch.id, { collectionId: album.id, duplicatePolicy: "reuse" }));
    expect(result.items.map((item) => item.status)).toEqual(["imported", "duplicate"]);
    expect(result.items[0]!.artworkId).toBe(result.items[1]!.artworkId);
    expect(database.listWorks()).toHaveLength(1);
    expect(database.listWorks()[0]!.collectionIds).toEqual([album.id]);
    expect(readFileSync(first)).toEqual(png); expect(readFileSync(second)).toEqual(png);
  });
  it("retries only failed items after a file is repaired", async () => {
    const { image, database, service } = fixture();
    const good = image("good.png"); const bad = image("bad.png", "broken");
    let result = await finish(service, service.start(1, service.choose(1, [good, bad])!.id, { collectionId: null, duplicatePolicy: "separate" }));
    expect(result.items.map((item) => item.status)).toEqual(["imported", "failed"]);
    expect(result.items[1]!.error).toContain("文件内容");
    const successId = result.items[0]!.artworkId;
    writeFileSync(bad, png);
    result = await finish(service, service.retry(1, result.id));
    expect(result.items.map((item) => item.status)).toEqual(["imported", "imported"]);
    expect(result.items[0]!.artworkId).toBe(successId);
    expect(database.listWorks()).toHaveLength(2);
  });
  it("does not clear an existing image assessment or duplicate a path", async () => {
    const { image, database, service } = fixture();
    const path = image("known.png");
    const existing = database.importArtwork(path);
    const assessment = { engine: "test", engineVersion: "1", elapsedMs: 10, status: "complete" as const, labels: { safe: 0.9 }, assessedAt: new Date().toISOString() };
    database.saveAssessment(existing.id, assessment, { action: "blur", reasons: [], decidedAt: new Date().toISOString() });
    const batch = await finish(service, service.start(1, service.choose(1, [path, path.toUpperCase()])!.id, { collectionId: null, duplicatePolicy: "separate" }));
    expect(batch.items).toHaveLength(1); expect(batch.items[0]!.status).toBe("existing");
    expect(database.listArtworks()[0]!.assessment).toEqual(assessment);
    expect(database.listArtworks()[0]!.decision?.action).toBe("blur");
  });
  it("stops before committing an in-flight image and cannot retry cancelled items", async () => {
    const { image, database } = fixture();
    let release!: (value: string) => void;
    const service = new LocalImportService(database, () => new Promise((done) => { release = done; }));
    const batch = service.start(1, service.choose(1, [image("one.png"), image("two.png")])!.id, { collectionId: null, duplicatePolicy: "reuse" });
    service.cancel(1, batch.id); release("hash");
    const result = await finish(service, batch);
    expect(result.phase).toBe("cancelled"); expect(result.items.every((item) => item.status === "cancelled")).toBe(true);
    expect(database.listWorks()).toHaveLength(0);
    expect(service.retry(1, result.id).phase).toBe("cancelled");
  });
  it("rejects foreign tokens, arbitrary path commands, invalid albums and oversized batches", () => {
    const { image, database, service } = fixture();
    const batch = service.choose(1, [image("one.png")])!;
    expect(() => service.get(2, batch.id)).toThrow("过期");
    expect(() => service.start(1, "E:/unselected.png", {})).toThrow("过期");
    expect(() => service.start(1, batch.id, { collectionId: "missing", duplicatePolicy: "reuse" })).toThrow("相册");
    expect(() => service.choose(1, Array(501).fill("large.png"))).toThrow("500");
    expect(parseImportOptions({ collectionId: 42, duplicatePolicy: "reuse" })).toBeNull();
    expect(database.listWorks()).toHaveLength(0);
  });
  it("rolls back a vanished album without leaving a half-imported work", async () => {
    const { image, database } = fixture();
    const path = image("one.png"); const hash = await fingerprintImage(path);
    expect(() => database.commitLocalImport(path, hash, "missing")).toThrow("相册");
    expect(database.listWorks()).toHaveLength(0); expect(database.listArtworks()).toHaveLength(0);
  });
  it("checks the current contents of a previously fingerprinted duplicate", async () => {
    const { image, database, service } = fixture();
    const first = image("first.png");
    const batch = await finish(service, service.start(1, service.choose(1, [first])!.id, { collectionId: null, duplicatePolicy: "reuse" }));
    expect(batch.items[0]!.status).toBe("imported");
    writeFileSync(first, Buffer.concat([png, Buffer.from("changed")]));
    const second = image("second.png");
    const next = await finish(service, service.start(1, service.choose(1, [second])!.id, { collectionId: null, duplicatePolicy: "reuse" }));
    expect(next.items[0]!.status).toBe("imported"); expect(database.listWorks()).toHaveLength(2);
  });
});
