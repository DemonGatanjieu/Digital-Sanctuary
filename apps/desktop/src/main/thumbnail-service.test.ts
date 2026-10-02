import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { WorkAssetRecord } from "@sanctuary/domain";
import { generateThumbnailBatch, thumbnailPathForAsset, type ThumbnailStore } from "./thumbnail-service";

function asset(id: string, path: string): WorkAssetRecord {
  return {
    id,
    workId: "work-1",
    legacyArtworkId: null,
    pageIndex: 0,
    path,
    mediaType: "image",
    extension: ".png",
    width: null,
    height: null,
    byteLength: 10,
    contentHash: null,
    thumbnailPath: null,
    fileState: "available",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z"
  };
}

describe("thumbnail service", () => {
  it("uses stable versioned cache paths", () => {
    const candidate = asset("asset-1", "E:\\gallery\\cover.png");
    expect(thumbnailPathForAsset("E:\\cache", candidate)).toBe(thumbnailPathForAsset("E:\\cache", candidate));
    expect(thumbnailPathForAsset("E:\\cache", { ...candidate, byteLength: 11 }))
      .not.toBe(thumbnailPathForAsset("E:\\cache", candidate));
  });

  it("generates once and persists the reusable thumbnail path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-thumbnail-service-"));
    const sourcePath = join(directory, "source.png");
    writeFileSync(sourcePath, "source");
    const candidate = asset("asset-1", sourcePath);
    let storedPath: string | null = null;
    const store: ThumbnailStore = {
      listAssetsNeedingThumbnails: () => storedPath ? [] : [candidate],
      updateAssetThumbnail: (_assetId, path) => {
        storedPath = path;
        return true;
      }
    };
    try {
      const first = await generateThumbnailBatch(store, directory, async (_source, target) => {
        writeFileSync(target, "thumbnail");
      });
      expect(first).toMatchObject({ attempted: 1, generated: 1, reused: 0, failedAssetIds: [] });
      expect(storedPath && existsSync(storedPath)).toBe(true);
      expect(await generateThumbnailBatch(store, directory, async () => undefined))
        .toMatchObject({ attempted: 0, generated: 0 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("shares an overlapping batch and releases it for the next request", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-thumbnail-overlap-"));
    const candidate = asset("asset-overlap", join(directory, "source.png"));
    let storedPath: string | null = null;
    let release!: () => void;
    let started!: () => void;
    const startedEncoding = new Promise<void>((resolve) => { started = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const store: ThumbnailStore = {
      listAssetsNeedingThumbnails: vi.fn(() => storedPath ? [] : [candidate]),
      updateAssetThumbnail: vi.fn((_id, path) => { storedPath = path; return true; })
    };
    const encode = vi.fn(async (_source: string, target: string) => {
      started();
      await barrier;
      writeFileSync(target, "thumbnail");
    });
    try {
      const first = generateThumbnailBatch(store, directory, encode, 6);
      await startedEncoding;
      const overlapping = generateThumbnailBatch(store, directory, encode, 6);
      expect(overlapping).toBe(first);
      expect(store.listAssetsNeedingThumbnails).toHaveBeenCalledTimes(1);
      release();
      expect(await first).toEqual(await overlapping);
      expect(encode).toHaveBeenCalledTimes(1);
      expect(store.updateAssetThumbnail).toHaveBeenCalledTimes(1);
      expect(await generateThumbnailBatch(store, directory, encode, 6)).toMatchObject({ attempted: 0 });
      expect(store.listAssetsNeedingThumbnails).toHaveBeenCalledTimes(2);
    } finally {
      release();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("releases a failed batch so the next request can retry", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-thumbnail-retry-"));
    const store: ThumbnailStore = {
      listAssetsNeedingThumbnails: vi.fn()
        .mockImplementationOnce(() => { throw new Error("Database unavailable"); })
        .mockReturnValue([]),
      updateAssetThumbnail: () => true
    };
    try {
      await expect(generateThumbnailBatch(store, directory, async () => undefined)).rejects.toThrow("Database unavailable");
      await expect(generateThumbnailBatch(store, directory, async () => undefined)).resolves.toMatchObject({ attempted: 0 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
