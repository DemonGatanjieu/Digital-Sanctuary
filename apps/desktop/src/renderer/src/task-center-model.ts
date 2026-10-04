import type { AnalysisTaskSummary, LocalImportBatch } from "@sanctuary/domain";
import type { ExploreDownloadState } from "../../shared/pixiv-download";

export interface ThumbnailActivity {
  phase: "idle" | "running" | "completed" | "partial" | "failed";
  generated: number;
  reused: number;
  failed: number;
  limited: boolean;
  message: string;
}
export const INITIAL_THUMBNAIL_ACTIVITY: ThumbnailActivity = { phase: "idle", generated: 0, reused: 0, failed: 0, limited: false, message: "" };
export function analysisTaskLabel(job: AnalysisTaskSummary): string {
  if (job.cancelRequested && job.status === "running") return "正在停止";
  if (job.status === "completed" && job.failedItems > 0) return job.failedItems >= job.totalItems ? "识别失败" : "部分完成";
  return { queued: "等待开始", running: "处理中", completed: "已完成", failed: "失败", cancelled: "已停止" }[job.status];
}
export function activeTaskCount(batch: LocalImportBatch | null, download: ExploreDownloadState, thumbnails: ThumbnailActivity, jobs: AnalysisTaskSummary[]): number {
  return Number(batch?.phase === "running") + Number(["discovering", "downloading"].includes(download.phase))
    + Number(thumbnails.phase === "running") + jobs.filter((job) => job.status === "queued" || job.status === "running").length;
}
export function importTaskCounts(batch: LocalImportBatch) {
  const count = (status: string) => batch.items.filter((item) => item.status === status).length;
  return { processed: batch.items.length - count("pending"), imported: count("imported"), existing: count("existing") + count("duplicate"), failed: count("failed"), cancelled: count("cancelled") };
}
