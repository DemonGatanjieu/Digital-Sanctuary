import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import { parseWorkId, parseWorkQuery, parseWorkViewRequest } from "../shared/library-query.js";
import { generateThumbnailBatch, type ThumbnailBatchResult, type ThumbnailEncoder } from "./thumbnail-service.js";

export function registerLibraryReadIpc(ipc: IpcMain, database: LibraryDatabase, thumbnailDirectory: string, encoder: ThumbnailEncoder): void {
  ipc.handle("library:list", () => database.listArtworks());
  ipc.handle("library:query-works", (_event, query: unknown) => database.queryWorks(parseWorkQuery(query)));
  ipc.handle("library:get-work", (_event, value: unknown) => {
    const workId = parseWorkId(value);
    if (!workId) throw new Error("Invalid work id");
    return database.getWork(workId);
  });
  ipc.handle("library:record-work-view", (_event, value: unknown) => {
    const target = parseWorkViewRequest(value);
    if (!target) throw new Error("Invalid work view target");
    return database.recordWorkView(target.workId, target.assetId);
  });
  ipc.handle("library:get-generation-provenance", (_event, value: unknown) => {
    const workId = parseWorkId(value);
    if (!workId) throw new Error("Invalid work id");
    return database.getGenerationProvenance(workId);
  });
  ipc.handle("library:generate-thumbnails", (): Promise<ThumbnailBatchResult> =>
    generateThumbnailBatch(database, thumbnailDirectory, encoder, 6)
  );
}
