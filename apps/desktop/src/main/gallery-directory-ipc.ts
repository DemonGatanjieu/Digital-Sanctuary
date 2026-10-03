import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import { parseArtworkPageQuery, parseCollectionArtworkBatch, parseDirectoryPageQuery, parseGalleryScope } from "../shared/gallery-directory-query.js";

export function registerGalleryDirectoryIpc(ipc: IpcMain, database: LibraryDatabase): void {
  ipc.handle("collections:summaries", () => database.listCollectionSummaries());
  ipc.handle("artists:summaries", () => database.listArtistSummaries());
  ipc.handle("saved-collection-views:summaries", (_event, query: unknown) => database.querySavedViewSummaries(parseDirectoryPageQuery(query)));
  ipc.handle("library:scoped-artworks", (_event, value: unknown) => {
    const scope = parseGalleryScope(value);
    if (!scope) throw new Error("请选择有效的相册、画师或作品。");
    return database.listScopedArtworks(scope);
  });
  ipc.handle("library:query-artwork-pages", (_event, query: unknown) => database.queryArtworkPages(parseArtworkPageQuery(query)));
  ipc.handle("collections:add-artworks", (_event, ids: unknown, collectionId: unknown) => {
    const batch = parseCollectionArtworkBatch(ids, collectionId);
    if (!batch) throw new Error("请选择有效的相册和 1–500 张图片。");
    return database.addArtworksToCollection(batch.artworkIds, batch.collectionId);
  });
}
