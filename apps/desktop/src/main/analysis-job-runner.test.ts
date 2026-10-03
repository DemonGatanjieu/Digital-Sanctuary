import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisQueueItem } from "@sanctuary/database";
import type { VisionAssessment } from "@sanctuary/domain";
import { runAnalysisJob, type AnalysisJobStore } from "./analysis-job-runner.js";

const assessment: VisionAssessment = { status: "complete", engine: "test", engineVersion: "1", labels: { blue_hair: .8 }, elapsedMs: 1 };

describe("runAnalysisJob", () => {
  it("reuses a cached result without invoking the model", async () => {
    const path = join(tmpdir(), `sanctuary-runner-${Date.now()}.png`);
    writeFileSync(path, "fixture");
    const item: AnalysisQueueItem = { id: "item", jobId: "job", workId: "work", assetId: "asset", path, assetUpdatedAt: "1" };
    const finish = vi.fn<AnalysisJobStore["finishAnalysisJob"]>();
    const complete = vi.fn<AnalysisJobStore["completeAnalysisItem"]>();
    const store = fakeStore(item, finish, complete, assessment);
    const classify = vi.fn();
    try {
      await runAnalysisJob("job", store, { engine: "test", engineVersion: "1", classify });
      expect(store.getCachedAssetAnalysis).toHaveBeenCalledWith("asset", "1", "test", "1");
      expect(classify).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledWith(item, assessment, true);
      expect(finish).toHaveBeenCalledWith("job", "completed");
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("honors cancellation before starting", async () => {
    const finish = vi.fn<AnalysisJobStore["finishAnalysisJob"]>();
    const store = fakeStore(null, finish, vi.fn<AnalysisJobStore["completeAnalysisItem"]>(), null);
    store.isAnalysisCancellationRequested = () => true;
    await runAnalysisJob("job", store, { engine: "test", classify: vi.fn() });
    expect(finish).toHaveBeenCalledWith("job", "cancelled");
    expect(store.startAnalysisJob).not.toHaveBeenCalled();
  });
});

function fakeStore(item: AnalysisQueueItem | null, finish: AnalysisJobStore["finishAnalysisJob"], complete: AnalysisJobStore["completeAnalysisItem"], cached: VisionAssessment | null): AnalysisJobStore {
  let next = item;
  return {
    isAnalysisCancellationRequested: vi.fn(() => false),
    startAnalysisJob: vi.fn(() => true),
    claimNextAnalysisItem: vi.fn(() => { const value = next; next = null; return value; }),
    getCachedAssetAnalysis: vi.fn(() => cached),
    completeAnalysisItem: complete,
    failAnalysisItem: vi.fn(),
    finishAnalysisJob: finish
  };
}
