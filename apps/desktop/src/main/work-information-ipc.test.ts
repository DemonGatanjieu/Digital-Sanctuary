import { describe, expect, it } from "vitest";
import { LibraryDatabase } from "@sanctuary/database";
import { registerWorkInformationIpc } from "./work-information-ipc";
import type { IpcMain } from "electron";
import type { WorkInformation } from "@sanctuary/domain";

describe("stored work information", () => {
  it("reads only the requested work/page, preserves metadata and never starts analysis", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      const first = database.importArtwork("E:/fixture/first.png");
      const second = database.importArtwork("E:/fixture/second.png");
      const album = database.createCollection("资料相册");
      database.addArtworkToCollection(first.id, album.id);
      const assessment = { status: "complete" as const, engine: "historical", engineVersion: "1", elapsedMs: 5, labels: { cat: .9 } };
      database.saveAssessment(first.id, assessment, { action: "allow", reasons: [], decidedAt: new Date().toISOString() });
      const handlers = new Map<string, (...args: unknown[]) => unknown>();
      registerWorkInformationIpc({ handle: (channel, handler) => handlers.set(channel, handler as (...args: unknown[]) => unknown) } as Pick<IpcMain, "handle">, database);
      const read = handlers.get("library:work-information")!;
      const result = read({}, `local:${first.id}`, 0) as WorkInformation;
      expect(result.assessment).toEqual(assessment);
      expect(result.work.collectionIds).toEqual([album.id]); expect(result.evaluations).toEqual([]); expect(result.provenance).toBeNull();
      expect(database.listAnalysisJobs()).toEqual([]);
      const asset = result.work.assets[0]!;
      expect(database.getStoredAssetAssessment(`local:${second.id}`, asset.id)).toBeNull();
      expect((read({}, `local:${first.id}`, 99) as WorkInformation).assessment).toBeNull();
      database.removeWorkFromIndex(result.work.id);
      expect(read({}, result.work.id, 0)).toBeNull();
      expect(database.getStoredAssetAssessment(result.work.id, asset.id)).toBeNull();
    } finally { database.close(); }
  });
  it("rejects malformed page requests before querying", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      let read!: (...args: unknown[]) => unknown;
      registerWorkInformationIpc({ handle: (_channel, handler) => { read = handler as (...args: unknown[]) => unknown; } } as Pick<IpcMain, "handle">, database);
      expect(() => read({}, "local:x", -1)).toThrow("无效");
      expect(() => read({}, "local:x", 1.5)).toThrow("无效");
      expect(() => read({}, { path: "arbitrary" }, 0)).toThrow("无效");
    } finally { database.close(); }
  });
});
