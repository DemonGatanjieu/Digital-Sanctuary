import type { ArtistSummary, CollectionSummary, GalleryScope, SavedViewSummary, SavedViewSummaryResult, ScopedArtworkRecord } from "@sanctuary/domain";

type DirectoryMode = "flat" | "author-work" | "collections";
interface DirectoryApi {
  listCollectionSummaries(): Promise<CollectionSummary[]>;
  listArtistSummaries(): Promise<ArtistSummary[]>;
  querySavedViewSummaries(query: { offset: number; limit: number }): Promise<SavedViewSummaryResult>;
  listScopedArtworks(scope: GalleryScope): Promise<ScopedArtworkRecord[]>;
}
export interface GalleryDirectoryState {
  collectionSummaries: CollectionSummary[];
  artistSummaries: ArtistSummary[];
  savedViewSummaries: SavedViewSummary[];
  savedViewsTotal: number;
  savedViewsHasMore: boolean;
  directoryLoading: boolean;
  savedViewsLoading: boolean;
  directoryReadyMode: DirectoryMode | null;
  scopedArtworks: ScopedArtworkRecord[];
  scopedKey: string;
  scopeLoading: boolean;
}
export const emptyGalleryDirectory = (): GalleryDirectoryState => ({
  collectionSummaries: [], artistSummaries: [], savedViewSummaries: [], savedViewsTotal: 0, savedViewsHasMore: false,
  directoryLoading: false, savedViewsLoading: false, directoryReadyMode: null, scopedArtworks: [], scopedKey: "", scopeLoading: false
});
export function galleryScopeKey(scope: GalleryScope | null): string {
  return scope ? JSON.stringify(scope) : "";
}

/** Directory and detail reads have independent generations; neither can publish into a new range. */
export class GalleryDirectoryController {
  state = emptyGalleryDirectory();
  private mode: DirectoryMode = "flat";
  private scope: GalleryScope | null = null;
  private active = false;
  private directoryGeneration = 0;
  private scopeGeneration = 0;
  private savedOffset = 0;
  constructor(private api: DirectoryApi, private publish: (state: GalleryDirectoryState) => void, private onError: (error: unknown) => void) {}
  private update(patch: Partial<GalleryDirectoryState>) { this.state = { ...this.state, ...patch }; this.publish(this.state); }
  setContext(mode: DirectoryMode, scope: GalleryScope | null, active: boolean): void {
    const directoryChanged = this.mode !== mode || this.active !== active;
    const scopeChanged = directoryChanged || galleryScopeKey(this.scope) !== galleryScopeKey(scope);
    this.mode = mode; this.scope = scope; this.active = active;
    if (directoryChanged) {
      this.directoryGeneration += 1;
      this.update({ directoryLoading: false, savedViewsLoading: false });
      if (active) void this.refreshDirectory().catch(this.onError);
    }
    if (scopeChanged) {
      this.scopeGeneration += 1;
      this.update({ scopedArtworks: [], scopedKey: galleryScopeKey(scope), scopeLoading: false });
      if (active) void this.refreshScope().catch(this.onError);
    }
  }
  invalidate(): void {
    this.active = false; this.directoryGeneration += 1; this.scopeGeneration += 1;
  }
  async refresh(): Promise<void> { await Promise.all([this.refreshDirectory(), this.refreshScope()]); }
  async refreshDirectory(): Promise<void> {
    if (!this.active || this.mode === "flat") return;
    const mode = this.mode, generation = ++this.directoryGeneration;
    this.update({ directoryLoading: true, savedViewsLoading: false });
    try {
      if (mode === "author-work") {
        const summaries = await this.api.listArtistSummaries();
        if (generation === this.directoryGeneration) this.update({ artistSummaries: summaries, directoryReadyMode: mode });
      } else {
        const target = Math.max(12, this.state.savedViewSummaries.length);
        const [collections, firstPage] = await Promise.all([
          this.api.listCollectionSummaries(), this.api.querySavedViewSummaries({ offset: 0, limit: 12 })
        ]);
        let page = firstPage, items = [...page.items], offset = page.offset + page.items.length;
        // Revalidate only the previously loaded saved-view range, with bounded, sequential requests.
        while (page.hasMore && items.length < target && page.items.length && generation === this.directoryGeneration) {
          page = await this.api.querySavedViewSummaries({ offset, limit: Math.min(12, target - items.length) });
          items.push(...page.items); offset = page.offset + page.items.length;
        }
        if (generation === this.directoryGeneration) {
          this.savedOffset = offset;
          this.update({ collectionSummaries: collections, savedViewSummaries: items, savedViewsTotal: page.total,
            savedViewsHasMore: page.hasMore, directoryReadyMode: mode });
        }
      }
    } catch (error) { if (generation === this.directoryGeneration) throw error; }
    finally { if (generation === this.directoryGeneration) this.update({ directoryLoading: false }); }
  }
  async refreshScope(): Promise<void> {
    if (!this.active || !this.scope || this.mode === "flat") return;
    const scope = this.scope, generation = ++this.scopeGeneration;
    this.update({ scopeLoading: true });
    try {
      const items = await this.api.listScopedArtworks(scope);
      if (generation === this.scopeGeneration) this.update({ scopedArtworks: items });
    } catch (error) { if (generation === this.scopeGeneration) throw error; }
    finally { if (generation === this.scopeGeneration) this.update({ scopeLoading: false }); }
  }
  async loadMoreSavedViews(): Promise<void> {
    if (!this.active || this.mode !== "collections" || this.state.directoryLoading || this.state.savedViewsLoading || !this.state.savedViewsHasMore) return;
    const generation = this.directoryGeneration;
    this.update({ savedViewsLoading: true });
    try {
      const page = await this.api.querySavedViewSummaries({ offset: this.savedOffset, limit: 12 });
      if (generation !== this.directoryGeneration) return;
      this.savedOffset = page.offset + page.items.length;
      const known = new Set(this.state.savedViewSummaries.map((item) => item.id));
      this.update({ savedViewSummaries: [...this.state.savedViewSummaries, ...page.items.filter((item) => !known.has(item.id))],
        savedViewsTotal: page.total, savedViewsHasMore: page.hasMore && page.items.length > 0 });
    } catch (error) { if (generation === this.directoryGeneration) this.onError(error); }
    finally { if (generation === this.directoryGeneration) this.update({ savedViewsLoading: false }); }
  }
}
