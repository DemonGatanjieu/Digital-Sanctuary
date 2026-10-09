import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import type { ElementIndexStatus, WorkQuery } from "@sanctuary/domain";
import { parseWorkId, parseWorkQuery, parseWorkViewRequest } from "../shared/library-query.js";
import { readImageHeaderSize } from "./image-header-size.js";
import { generateThumbnailBatch, type ThumbnailBatchResult, type ThumbnailEncoder } from "./thumbnail-service.js";

export function registerLibraryReadIpc(ipc: IpcMain, database: LibraryDatabase, thumbnailDirectory: string, encoder: ThumbnailEncoder,
  resolveQuery: (query: WorkQuery) => WorkQuery = (query) => query, activeTagger: () => string | null = () => null): void {
  ipc.handle("library:list", () => database.listArtworks());
  ipc.handle("library:query-works", (_event, query: unknown) => database.queryWorks(resolveQuery(parseWorkQuery(query))));
  ipc.handle("library:element-coverage", (): ElementIndexStatus => {
    const engine = activeTagger();
    return { engine: engine ?? "", ...(engine ? database.elementCoverage(engine) : { totalAssets: 0, taggedAssets: 0 }) };
  });
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
    generateThumbnailBatch(database, thumbnailDirectory, encoder, 6, (path) => readImageHeaderSize(path, 256 * 1024))
  );
}
