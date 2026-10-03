import { describe, expect, it, vi } from "vitest";
import type { ArtistSummary, CollectionSummary, GalleryScope, SavedViewSummary, SavedViewSummaryResult, ScopedArtworkRecord } from "@sanctuary/domain";
import { GalleryDirectoryController } from "./gallery-directory-controller";

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture() {
  const scopes: { scope: GalleryScope; task: ReturnType<typeof deferred<ScopedArtworkRecord[]>> }[] = [];
  const saved = (offset = 0, count = 12, total = 35): SavedViewSummaryResult => ({
    items: Array.from({ length: Math.min(count, total - offset) }, (_, i) => ({ id: String(offset + i) } as SavedViewSummary)),
    offset, limit: count, total, hasMore: offset + count < total
  });
  const api = {
    listCollectionSummaries: vi.fn(async (): Promise<CollectionSummary[]> => []),
    listArtistSummaries: vi.fn(async (): Promise<ArtistSummary[]> => []),
    querySavedViewSummaries: vi.fn(async (query: { offset: number; limit: number }) => saved(query.offset, query.limit)),
    listScopedArtworks: vi.fn((scope: GalleryScope) => { const task = deferred<ScopedArtworkRecord[]>(); scopes.push({ scope, task }); return task.promise; })
  };
  const errors = vi.fn(), publish = vi.fn();
  const controller = new GalleryDirectoryController(api, publish, errors);
  return { api, controller, scopes, errors, publish, saved };
}

describe("gallery directory data flow", () => {
  it("loads only the chosen directory and reads a required detail scope", async () => {
    const { api, controller, scopes } = fixture();
    controller.setContext("flat", null, true); await settle();
    expect(api.listCollectionSummaries).not.toHaveBeenCalled(); expect(api.listArtistSummaries).not.toHaveBeenCalled();
    controller.setContext("author-work", null, true); await settle();
    expect(api.listArtistSummaries).toHaveBeenCalledOnce(); expect(api.querySavedViewSummaries).not.toHaveBeenCalled();
    controller.setContext("author-work", { kind: "artist", artistId: null }, true);
    expect(scopes[0]!.scope).toEqual({ kind: "artist", artistId: null });
    scopes[0]!.task.resolve([{ id: "unknown-page" } as ScopedArtworkRecord]); await settle();
    expect(controller.state.scopedArtworks[0]!.id).toBe("unknown-page");
    expect(api.listArtistSummaries).toHaveBeenCalledOnce();
  });
  it("keeps current detail and loading state when older scopes succeed or fail", async () => {
    const { controller, scopes, errors } = fixture();
    controller.setContext("collections", { kind: "collection", collectionId: "old" }, true);
    controller.setContext("collections", { kind: "collection", collectionId: "new" }, true);
    expect(controller.state.scopedArtworks).toEqual([]);
    scopes[0]!.task.reject(new Error("old error")); await settle();
    expect(controller.state.scopeLoading).toBe(true); expect(errors).not.toHaveBeenCalled();
    scopes[1]!.task.resolve([{ id: "new-page" } as ScopedArtworkRecord]); await settle();
    controller.setContext("collections", { kind: "collection", collectionId: "third" }, true);
    controller.setContext("collections", null, true);
    scopes[2]!.task.resolve([{ id: "late-third" } as ScopedArtworkRecord]); await settle();
    expect(controller.state.scopedArtworks).toEqual([]); expect(controller.state.scopeLoading).toBe(false);
  });
  it("invalidates hidden route replies and retries a current failure on return", async () => {
    const { controller, scopes, errors, publish } = fixture();
    const scope: GalleryScope = { kind: "collection", collectionId: "album" };
    controller.setContext("collections", scope, true);
    controller.setContext("collections", scope, false); await settle(); publish.mockClear();
    scopes[0]!.task.resolve([{ id: "hidden" } as ScopedArtworkRecord]); await settle();
    expect(publish).not.toHaveBeenCalled();
    controller.setContext("collections", scope, true); scopes[1]!.task.reject(new Error("current")); await settle();
    expect(errors).toHaveBeenCalledOnce(); expect(controller.state.scopeLoading).toBe(false);
    const retry = controller.refreshScope(); scopes[2]!.task.resolve([{ id: "retry" } as ScopedArtworkRecord]); await retry;
    expect(controller.state.scopedArtworks[0]!.id).toBe("retry");
  });
  it("locks saved-view pagination and retains loaded range through bounded revalidation", async () => {
    const { controller, api, saved } = fixture();
    controller.setContext("collections", null, true); await settle();
    const task = deferred<SavedViewSummaryResult>(); api.querySavedViewSummaries.mockImplementationOnce(() => task.promise);
    const more = controller.loadMoreSavedViews(), duplicate = controller.loadMoreSavedViews();
    expect(api.querySavedViewSummaries).toHaveBeenCalledTimes(2);
    task.resolve(saved(12)); await Promise.all([more, duplicate]);
    expect(controller.state.savedViewSummaries).toHaveLength(24);
    api.querySavedViewSummaries.mockClear(); await controller.refreshDirectory();
    expect(api.querySavedViewSummaries.mock.calls.map(([query]) => query)).toEqual([{ offset: 0, limit: 12 }, { offset: 12, limit: 12 }]);
    expect(controller.state.savedViewSummaries).toHaveLength(24);
  });
  it("ignores old saved-view pages and old directory errors after switching modes", async () => {
    const { controller, api, saved, errors } = fixture();
    controller.setContext("collections", null, true); await settle();
    const task = deferred<SavedViewSummaryResult>(); api.querySavedViewSummaries.mockImplementationOnce(() => task.promise);
    const more = controller.loadMoreSavedViews(); controller.setContext("author-work", null, true);
    task.resolve(saved(12)); await more; await settle();
    expect(controller.state.savedViewSummaries).toHaveLength(12); expect(controller.state.savedViewsLoading).toBe(false);
    const old = deferred<CollectionSummary[]>(); api.listCollectionSummaries.mockImplementationOnce(() => old.promise);
    controller.setContext("collections", null, true); controller.setContext("flat", null, true);
    old.reject(new Error("late directory")); await settle();
    expect(errors).not.toHaveBeenCalled(); expect(controller.state.directoryLoading).toBe(false);
  });
});
