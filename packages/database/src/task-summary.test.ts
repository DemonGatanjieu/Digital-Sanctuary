import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryDatabase } from "./index.js";

describe("lightweight analysis task summaries", () => {
  it("reports real failures and cancellation without expanding suggestions", () => {
    const root = mkdtempSync(join(tmpdir(), "sanctuary-task-summary-"));
    const database = new LibraryDatabase(":memory:");
    try {
      const path = join(root, "one.png"); writeFileSync(path, "fixture");
      const artwork = database.importArtwork(path);
      const job = database.createAnalysisJob({ type: "selected", workIds: [`local:${artwork.id}`] }, "fixture");
      database.startAnalysisJob(job.id);
      const item = database.claimNextAnalysisItem(job.id)!;
      database.failAnalysisItem(item, "fixture failure");
      database.finishAnalysisJob(job.id, "completed");
      const fullList = vi.spyOn(database, "listAnalysisJobs");
      const [summary] = database.listAnalysisTaskSummaries();
      expect(summary).toMatchObject({ id: job.id, scopeType: "selected", status: "completed", totalItems: 1, processedItems: 1, failedItems: 1 });
      expect(summary).not.toHaveProperty("suggestions"); expect(summary).not.toHaveProperty("scope");
      expect(fullList).not.toHaveBeenCalled();
      const queued = database.createAnalysisJob({ type: "all" }, "fixture");
      database.requestAnalysisCancellation(queued.id);
      expect(database.listAnalysisTaskSummaries().find((entry) => entry.id === queued.id)).toMatchObject({ status: "cancelled", cancelRequested: true });
    } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it("bounds task history even when the database retains more jobs", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      for (let index = 0; index < 35; index++) database.createAnalysisJob({ type: "all" }, "fixture");
      expect(database.listAnalysisTaskSummaries()).toHaveLength(30);
    } finally { database.close(); }
  });
});
