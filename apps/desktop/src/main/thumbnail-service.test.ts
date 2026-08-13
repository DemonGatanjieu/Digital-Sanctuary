import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
});
