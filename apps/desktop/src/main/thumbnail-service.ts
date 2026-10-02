import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { WorkAssetRecord } from "@sanctuary/domain";

export const THUMBNAIL_CACHE_VERSION = "v1";

export interface ThumbnailStore {
  listAssetsNeedingThumbnails(limit?: number): WorkAssetRecord[];
  updateAssetThumbnail(assetId: string, thumbnailPath: string | null): boolean;
}

export interface ThumbnailBatchResult {
  attempted: number;
  generated: number;
  reused: number;
  failedAssetIds: string[];
}

export type ThumbnailEncoder = (sourcePath: string, targetPath: string) => Promise<void>;

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
  limit = 24
): Promise<ThumbnailBatchResult> {
  const pending = inFlightBatches.get(store);
  if (pending) return pending;
  const batch = runThumbnailBatch(store, cacheRoot, encode, limit);
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
  limit: number
): Promise<ThumbnailBatchResult> {
  const assets = store.listAssetsNeedingThumbnails(limit);
  const result: ThumbnailBatchResult = {
    attempted: assets.length,
    generated: 0,
    reused: 0,
    failedAssetIds: []
  };
  if (assets.length === 0) return result;

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
