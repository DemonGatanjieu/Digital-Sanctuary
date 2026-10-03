import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import { describe, expect, it, vi } from "vitest";
import { registerGalleryDirectoryIpc } from "./gallery-directory-ipc.js";

describe("directory IPC boundaries", () => {
  it("routes bounded scoped reads and one batch write without returning the library", () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const db = {
      listCollectionSummaries: vi.fn(() => []), listArtistSummaries: vi.fn(() => []),
      querySavedViewSummaries: vi.fn(() => ({ items: [] })), listScopedArtworks: vi.fn(() => []),
      queryArtworkPages: vi.fn(() => ({ items: [] })), addArtworksToCollection: vi.fn(() => 2), listArtworks: vi.fn()
    };
    registerGalleryDirectoryIpc({ handle: (key: string, fn: (...args: unknown[]) => unknown) => handlers.set(key, fn) } as unknown as IpcMain, db as unknown as LibraryDatabase);
    handlers.get("saved-collection-views:summaries")!({}, { limit: 10000, offset: 12, sql: "private" });
    expect(db.querySavedViewSummaries).toHaveBeenCalledWith({ limit: 12, offset: 12 });
    handlers.get("library:scoped-artworks")!({}, { kind: "artist", artistId: null, path: "E:/private" });
    expect(db.listScopedArtworks).toHaveBeenCalledWith({ kind: "artist", artistId: null });
    expect(() => handlers.get("library:scoped-artworks")!({}, { kind: "all" })).toThrow("请选择有效");
    expect(db.listScopedArtworks).toHaveBeenCalledTimes(1);
    expect(handlers.get("collections:add-artworks")!({}, ["page:1", "page:1", "page:2"], "collection:1")).toBe(2);
    expect(db.addArtworksToCollection).toHaveBeenCalledWith(["page:1", "page:2"], "collection:1");
    expect(() => handlers.get("collections:add-artworks")!({}, ["page:1", "E:/private"], "collection:1")).toThrow("1–500");
    expect(db.addArtworksToCollection).toHaveBeenCalledTimes(1);
    expect(db.listArtworks).not.toHaveBeenCalled();
  });
});
