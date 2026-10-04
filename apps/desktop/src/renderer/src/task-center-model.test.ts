import { describe, expect, it } from "vitest";
import type { AnalysisTaskSummary, LocalImportBatch } from "@sanctuary/domain";
import { IDLE_EXPLORE_DOWNLOAD_STATE } from "../../shared/pixiv-download";
import { activeTaskCount, analysisTaskLabel, importTaskCounts, INITIAL_THUMBNAIL_ACTIVITY } from "./task-center-model";

function job(status: AnalysisTaskSummary["status"], extra: Partial<AnalysisTaskSummary> = {}): AnalysisTaskSummary {
  return { id: status, status, scopeType: "all", engine: "fixture", workCount: 3, totalItems: 3, processedItems: 0, failedItems: 0,
    cancelRequested: false, error: null, createdAt: "2026-10-04T00:00:00.000Z", ...extra };
}
describe("truthful task feedback", () => {
  it("distinguishes partial completion and pending cancellation", () => {
    expect(analysisTaskLabel(job("completed", { failedItems: 1 }))).toBe("部分完成");
    expect(analysisTaskLabel(job("completed"))).toBe("已完成");
    expect(analysisTaskLabel(job("completed", { failedItems: 3 }))).toBe("识别失败");
    expect(analysisTaskLabel(job("running", { cancelRequested: true }))).toBe("正在停止");
    expect(analysisTaskLabel(job("cancelled", { cancelRequested: true }))).toBe("已停止");
  });
  it("does not count history or cancelled work as active", () => {
    expect(activeTaskCount(null, IDLE_EXPLORE_DOWNLOAD_STATE, INITIAL_THUMBNAIL_ACTIVITY,
      [job("queued"), job("running"), job("completed"), job("failed"), job("cancelled")])).toBe(2);
    expect(activeTaskCount(null, { ...IDLE_EXPLORE_DOWNLOAD_STATE, phase: "downloading" }, { ...INITIAL_THUMBNAIL_ACTIVITY, phase: "running" }, [])).toBe(2);
  });
  it("keeps skipped/cancelled import items separate from successful results", () => {
    const batch: LocalImportBatch = { id: "batch", phase: "cancelled", collectionId: null, duplicatePolicy: "reuse", cancelRequested: true,
      items: ["imported", "existing", "duplicate", "failed", "cancelled", "pending"].map((status, index) => ({ id: String(index), fileName: "one.png", status: status as LocalImportBatch["items"][number]["status"] })) };
    expect(importTaskCounts(batch)).toEqual({ processed: 5, imported: 1, existing: 2, failed: 1, cancelled: 1 });
    expect(activeTaskCount(batch, IDLE_EXPLORE_DOWNLOAD_STATE, INITIAL_THUMBNAIL_ACTIVITY, [])).toBe(0);
  });
});
