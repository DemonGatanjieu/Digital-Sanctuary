import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { WorkAssetRecord } from "@sanctuary/domain";

export const THUMBNAIL_CACHE_VERSION = "v1";

export interface ThumbnailStore {
  listAssetsNeedingThumbnails(limit?: number): WorkAssetRecord[];
  updateAssetThumbnail(assetId: string, thumbnailPath: string | null): boolean;
  /** Optional: lets the gallery lay out images by their real proportions before they load. */
  listAssetsMissingDimensions?(limit?: number): Pick<WorkAssetRecord, "id" | "path">[];
  fillAssetDimensions?(assetId: string, width: number, height: number): boolean;
}

export interface ThumbnailBatchResult {
  attempted: number;
  generated: number;
  reused: number;
  failedAssetIds: string[];
  /** Assets whose pixel size was recorded in this batch. */
  measured?: number;
}

export type ThumbnailEncoder = (sourcePath: string, targetPath: string) => Promise<void>;
export type ImageSizeReader = (path: string) => Promise<{ width: number; height: number } | null>;

const inFlightBatches = new WeakMap<ThumbnailStore, Promise<ThumbnailBatchResult>>();

export function thumbnailPathForAsset(cacheRoot: string, asset: WorkAssetRecord): string {
  const fingerprint = createHash("sha256")
    .update(`${THUMBNAIL_CACHE_VERSION}\0${asset.id}\0${asset.path}\0${asset.contentHash ?? asset.byteLength ?? ""}`)
    .digest("hex");
  return join(cacheRoot, THUMBNAIL_CACHE_VERSION, `${fingerprint}.png`);
}

export function generateThumbnailBatch(
  store: ThumbnailStore,
  cacheRoot: string,
  encode: ThumbnailEncoder,
  limit = 24,
  readSize?: ImageSizeReader
): Promise<ThumbnailBatchResult> {
  const pending = inFlightBatches.get(store);
  if (pending) return pending;
  const batch = runThumbnailBatch(store, cacheRoot, encode, limit, readSize);
  inFlightBatches.set(store, batch);
  void batch.finally(() => {
    if (inFlightBatches.get(store) === batch) inFlightBatches.delete(store);
  }).catch(() => undefined);
  return batch;
}

async function runThumbnailBatch(
  store: ThumbnailStore,
  cacheRoot: string,
  encode: ThumbnailEncoder,
  limit: number,
  readSize?: ImageSizeReader
): Promise<ThumbnailBatchResult> {
  const assets = store.listAssetsNeedingThumbnails(limit);
  const result: ThumbnailBatchResult = {
    attempted: assets.length,
    generated: 0,
    reused: 0,
    failedAssetIds: []
  };
  if (assets.length === 0) {
    // Thumbnails are caught up; spend the idle batch recording sizes from file headers (no decoding).
    if (readSize && store.listAssetsMissingDimensions && store.fillAssetDimensions) {
      result.measured = 0;
      for (const asset of store.listAssetsMissingDimensions(limit * 8)) {
        const size = await readSize(asset.path).catch(() => null);
        if (size && store.fillAssetDimensions(asset.id, size.width, size.height)) result.measured += 1;
      }
    }
    return result;
  }

  await mkdir(join(cacheRoot, THUMBNAIL_CACHE_VERSION), { recursive: true });
  for (const asset of assets) {
    const targetPath = thumbnailPathForAsset(cacheRoot, asset);
    try {
      if (existsSync(targetPath)) {
        result.reused += 1;
      } else {
        await encode(asset.path, targetPath);
        result.generated += 1;
      }
      store.updateAssetThumbnail(asset.id, targetPath);
    } catch {
      result.failedAssetIds.push(asset.id);
    }
  }
  return result;
}
