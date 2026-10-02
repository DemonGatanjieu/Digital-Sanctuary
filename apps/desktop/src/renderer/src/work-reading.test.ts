import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtworkRecord, WorkAssetRecord, WorkReadingProgress, WorkRecord } from "@sanctuary/domain";
import { artworkReadingAsset, initialWorkPageIndex, WorkReadingRecorder } from "./work-reading";

const asset = (id: string, fileState: WorkAssetRecord["fileState"] = "available") => ({ id, workId: "work", path: `${id}.png`, legacyArtworkId: `legacy-${id}`, mediaType: "image", fileState } as WorkAssetRecord);
const work = (assets: WorkAssetRecord[], assetId?: string) => ({ id: "work", assets, ...(assetId ? { readingProgress: { workId: "work", assetId, viewedAt: "now" } } : {}) } as WorkRecord);
const progress = (assetId: string) => ({ workId: "work", assetId, viewedAt: "now" } satisfies WorkReadingProgress);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
afterEach(() => vi.useRealTimers());

describe("reading page selection", () => {
  it("resumes the stored available image or falls back to the first usable image", () => {
    const assets = [asset("missing", "missing"), asset("first"), asset("last")];
    expect(initialWorkPageIndex(work(assets, "last"))).toBe(2);
    expect(initialWorkPageIndex(work(assets, "missing"))).toBe(1);
    expect(initialWorkPageIndex(work(assets, "deleted"))).toBe(1);
    expect(initialWorkPageIndex(work(assets))).toBe(1);
    const foreign = work(assets, "last");
    foreign.readingProgress!.workId = "other-work";
    expect(initialWorkPageIndex(foreign)).toBe(1);
  });

  it("does not resume nonimage assets and handles an empty work", () => {
    const nonimage = { ...asset("animation"), mediaType: "ugoira" } as WorkAssetRecord;
    expect(initialWorkPageIndex(work([nonimage, asset("still")], "animation"))).toBe(1);
    expect(initialWorkPageIndex(work([]))).toBe(0);
  });

  it("maps an explicitly clicked legacy page to its actual asset without choosing saved progress", () => {
    const full = work([asset("first"), asset("last")], "last");
    expect(artworkReadingAsset(full, { id: "legacy-first", path: "first.png" } as ArtworkRecord)?.id).toBe("first");
    expect(artworkReadingAsset(full, { id: "migrated", path: "last.png" } as ArtworkRecord)?.id).toBe("last");
    expect(artworkReadingAsset(full, { id: "unknown", path: "unknown.png" } as ArtworkRecord)).toBeNull();
    expect(artworkReadingAsset(work([asset("first", "missing")]), { id: "legacy-first", path: "first.png" } as ArtworkRecord)).toBeNull();
  });
});

describe("bounded reading persistence", () => {
  it("waits for canonical asset mapping after a loaded album page closes immediately", async () => {
    const mapping = deferred<string | null>();
    const record = vi.fn(async (_workId: string, id: string) => progress(id));
    const recorder = new WorkReadingRecorder(record, vi.fn());
    recorder.loadedResolved("work", () => mapping.promise);
    const closing = recorder.flush();
    await Promise.resolve();
    expect(record).not.toHaveBeenCalled();
    mapping.resolve("last");
    expect(await closing).toBe(true);
    expect(record).toHaveBeenLastCalledWith("work", "last");
  });

  it("keeps only the latest actually loaded page when old asset mappings arrive later", async () => {
    const old = deferred<string | null>();
    const current = deferred<string | null>();
    const record = vi.fn(async (_workId: string, id: string) => progress(id));
    const recorder = new WorkReadingRecorder(record, vi.fn());
    recorder.loadedResolved("work", () => old.promise);
    recorder.loadedResolved("work", () => current.promise);
    const closing = recorder.flush();
    current.resolve("last");
    expect(await closing).toBe(true);
    old.resolve("first");
    await Promise.resolve();
    await Promise.resolve();
    expect(record.mock.calls).toEqual([["work", "last"]]);
  });

  it("ignores stale mapping errors and reports the active mapping failure", async () => {
    const old = deferred<string | null>();
    const current = deferred<string | null>();
    const onError = vi.fn();
    const record = vi.fn(async () => null);
    const recorder = new WorkReadingRecorder(record, onError);
    recorder.loadedResolved("work", () => old.promise);
    recorder.loadedResolved("work", () => current.promise);
    const closing = recorder.flush();
    old.reject(new Error("old mapping failed"));
    current.reject(new Error("current mapping failed"));
    expect(await closing).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0].message).toBe("current mapping failed");
    expect(record).not.toHaveBeenCalled();
  });

  it("coalesces rapid successful page loads and avoids duplicate writes from viewer redraws", async () => {
    vi.useFakeTimers();
    const record = vi.fn(async (_workId: string, id: string) => progress(id));
    const recorder = new WorkReadingRecorder(record, vi.fn());
    recorder.loaded("work", "first");
    recorder.loaded("work", "middle");
    recorder.loaded("work", "last");
    await vi.advanceTimersByTimeAsync(499);
    expect(record).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenLastCalledWith("work", "last");
    recorder.loaded("work", "last");
    await vi.advanceTimersByTimeAsync(500);
    expect(record).toHaveBeenCalledTimes(1);
    expect(await recorder.flush()).toBe(true);
  });

  it("flushes a brief visit on close rather than losing its page to the debounce", async () => {
    vi.useFakeTimers();
    const record = vi.fn(async (_workId: string, id: string) => progress(id));
    const recorder = new WorkReadingRecorder(record, vi.fn());
    recorder.loaded("work", "last");
    expect(await recorder.flush()).toBe(true);
    expect(record).toHaveBeenLastCalledWith("work", "last");
    await vi.advanceTimersByTimeAsync(1000);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("serializes a slow write and flushes only the latest page behind it", async () => {
    vi.useFakeTimers();
    const first = deferred<WorkReadingProgress>();
    const record = vi.fn((_workId: string, id: string) => id === "first" ? first.promise : Promise.resolve(progress(id)));
    const recorder = new WorkReadingRecorder(record, vi.fn());
    recorder.loaded("work", "first");
    await vi.advanceTimersByTimeAsync(500);
    recorder.loaded("work", "middle");
    recorder.loaded("work", "last");
    const closing = recorder.flush();
    expect(record).toHaveBeenCalledTimes(1);
    first.resolve(progress("first"));
    expect(await closing).toBe(true);
    expect(record.mock.calls).toEqual([["work", "first"], ["work", "last"]]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("reports errors without losing a newer pending loaded page", async () => {
    vi.useFakeTimers();
    const first = deferred<WorkReadingProgress>();
    const error = new Error("disk unavailable");
    const onError = vi.fn();
    const record = vi.fn((_workId: string, id: string) => id === "first" ? first.promise : Promise.resolve(progress(id)));
    const recorder = new WorkReadingRecorder(record, onError);
    recorder.loaded("work", "first");
    await vi.advanceTimersByTimeAsync(500);
    recorder.loaded("work", "last");
    const closing = recorder.flush();
    first.reject(error);
    expect(await closing).toBe(true);
    expect(onError).toHaveBeenCalledWith(error);
    expect(record).toHaveBeenLastCalledWith("work", "last");
  });

  it("does not report successful progress when the DB rejects an unavailable asset", async () => {
    const record = vi.fn(async () => null);
    const recorder = new WorkReadingRecorder(record, vi.fn());
    expect(await recorder.flush()).toBe(false);
    expect(record).not.toHaveBeenCalled();
    recorder.loaded("work", "became-unavailable");
    expect(await recorder.flush()).toBe(false);
  });
});
