import type { ArtworkRecord, WorkAssetRecord, WorkReadingProgress, WorkRecord, WorkViewRequest } from "@sanctuary/domain";

export function isReadableWorkAsset(asset: WorkAssetRecord): boolean {
  return asset.mediaType === "image" && asset.fileState === "available";
}

export function initialWorkPageIndex(work: WorkRecord): number {
  const progress = work.readingProgress;
  if (progress?.workId === work.id) {
    const resumed = work.assets.findIndex((asset) => asset.id === progress.assetId && isReadableWorkAsset(asset));
    if (resumed >= 0) return resumed;
  }
  return Math.max(0, work.assets.findIndex(isReadableWorkAsset));
}

export function artworkReadingAsset(work: WorkRecord | null, artwork: ArtworkRecord): WorkAssetRecord | null {
  if (!work) return null;
  // Compatibility pages are mapped back to a validated asset ID, never submitted as an asset themselves.
  return work.assets.find((asset) => isReadableWorkAsset(asset) && asset.legacyArtworkId === artwork.id) ??
    work.assets.find((asset) => isReadableWorkAsset(asset) && asset.path === artwork.path) ?? null;
}

/** One pending page and one IPC write at a time; a short visit still saves its final successfully loaded page. */
export class WorkReadingRecorder {
  private pending: WorkViewRequest | null = null;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resolution: Promise<void> | null = null;
  private resolutionGeneration = 0;
  private lastQueued = "";
  private changed = false;

  constructor(
    private readonly record: (workId: string, assetId: string) => Promise<WorkReadingProgress | null>,
    private readonly onError: (error: unknown) => void,
    private readonly delayMs = 500
  ) {}

  loaded(workId: string, assetId: string): void {
    this.resolutionGeneration += 1;
    this.resolution = null;
    const key = JSON.stringify([workId, assetId]);
    if (key === this.lastQueued) return;
    this.lastQueued = key;
    this.pending = { workId, assetId };
    this.schedule();
  }

  loadedResolved(workId: string, resolveAssetId: () => Promise<string | null>): void {
    const generation = ++this.resolutionGeneration;
    const resolving = Promise.resolve().then(resolveAssetId).then((assetId) => {
      if (generation === this.resolutionGeneration && assetId) this.loaded(workId, assetId);
    }).catch((error: unknown) => {
      if (generation === this.resolutionGeneration) this.onError(error);
    }).finally(() => {
      if (this.resolution === resolving) this.resolution = null;
    });
    this.resolution = resolving;
  }

  async flush(): Promise<boolean> {
    this.clearTimer();
    while (this.resolution || this.inFlight || this.pending) {
      if (this.resolution) await this.resolution;
      if (this.inFlight) await this.inFlight;
      this.clearTimer();
      if (this.pending) await this.writePending();
    }
    return this.changed;
  }

  private schedule(): void {
    if (this.timer || this.inFlight || !this.pending) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writePending();
    }, this.delayMs);
  }

  private writePending(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const next = this.pending;
    if (!next) return Promise.resolve();
    this.pending = null;
    const writing = Promise.resolve().then(() => this.record(next.workId, next.assetId)).then((value) => {
      if (value) this.changed = true;
    }).catch((error: unknown) => {
      this.lastQueued = "";
      this.onError(error);
    }).finally(() => {
      this.inFlight = null;
      this.schedule();
    });
    this.inFlight = writing;
    return writing;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
