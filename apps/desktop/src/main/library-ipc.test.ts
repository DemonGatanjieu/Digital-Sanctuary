import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import type { WorkReadingProgress } from "@sanctuary/domain";
import { describe, expect, it, vi } from "vitest";
import { registerLibraryReadIpc } from "./library-ipc.js";

describe("library read and view recording IPC", () => {
  it("passes only validated query fields and view IDs to the database", () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const progress = { workId: "pixiv:42", assetId: "asset-1", viewedAt: "2026-10-03T00:00:00.000Z" };
    const database = {
      queryWorks: vi.fn(() => ({ items: [], total: 0 })),
      getWork: vi.fn(() => null), recordWorkView: vi.fn((): WorkReadingProgress | null => progress),
      listArtworks: vi.fn(() => []), getGenerationProvenance: vi.fn(() => null)
    };
    const ipc = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) } as unknown as IpcMain;
    registerLibraryReadIpc(ipc, database as unknown as LibraryDatabase, "E:/fixture/thumbnails", async () => undefined);
    handlers.get("library:query-works")!({}, { favorite: true, uncollected: true, viewedOnly: true, sortBy: "lastViewedAt", limit: 500, sql: "DROP TABLE works" });
    expect(database.queryWorks).toHaveBeenCalledWith({ favorite: true, uncollected: true, viewedOnly: true, sortBy: "lastViewedAt", limit: 200, offset: 0 });
    expect(handlers.get("library:record-work-view")!({}, { workId: "pixiv:42", assetId: "asset-1", viewedAt: "tomorrow", path: "E:/private/file.png" })).toEqual(progress);
    expect(database.recordWorkView).toHaveBeenCalledWith("pixiv:42", "asset-1");
    for (const target of [{ workId: "pixiv:42" }, { workId: "pixiv:42", assetId: "E:/private/file.png" }, { workId: "../work", assetId: "asset-1" }]) {
      expect(() => handlers.get("library:record-work-view")!({}, target)).toThrow("Invalid work view target");
    }
    expect(database.recordWorkView).toHaveBeenCalledTimes(1);
    database.recordWorkView.mockReturnValueOnce(null);
    expect(handlers.get("library:record-work-view")!({}, { workId: "pixiv:42", assetId: "asset-other-work" })).toBeNull();
  });
});
