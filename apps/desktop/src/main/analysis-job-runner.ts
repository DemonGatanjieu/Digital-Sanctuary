import { existsSync } from "node:fs";
import type { AnalysisQueueItem } from "@sanctuary/database";
import type { AnalysisJobStatus, VisionAssessment } from "@sanctuary/domain";

export interface AnalysisJobStore {
  isAnalysisCancellationRequested(jobId: string): boolean;
  startAnalysisJob(jobId: string): boolean;
  claimNextAnalysisItem(jobId: string): AnalysisQueueItem | null;
  getCachedAssetAnalysis(assetId: string, assetUpdatedAt: string, engine: string): VisionAssessment | null;
  completeAnalysisItem(item: AnalysisQueueItem, assessment: VisionAssessment, cached: boolean): void;
  failAnalysisItem(item: AnalysisQueueItem, error: string): void;
  finishAnalysisJob(jobId: string, status: Extract<AnalysisJobStatus, "completed" | "cancelled" | "failed">, error?: string | null): void;
}

export interface AnalysisVisionClient {
  engine: string;
  classify(path: string, timeoutMs?: number): Promise<VisionAssessment>;
}

export class AnalysisJobScheduler {
  readonly #scheduled = new Set<string>();
  #queue: Promise<void> = Promise.resolve();

  schedule(jobId: string, store: AnalysisJobStore, client: AnalysisVisionClient): void {
    if (this.#scheduled.has(jobId)) return;
    this.#scheduled.add(jobId);
    this.#queue = this.#queue
      .catch(() => undefined)
      .then(() => runAnalysisJob(jobId, store, client))
      .finally(() => this.#scheduled.delete(jobId));
  }
}

export async function runAnalysisJob(jobId: string, store: AnalysisJobStore, client: AnalysisVisionClient): Promise<void> {
  try {
    if (store.isAnalysisCancellationRequested(jobId)) {
      store.finishAnalysisJob(jobId, "cancelled");
      return;
    }
    if (!store.startAnalysisJob(jobId)) return;
    while (true) {
      if (store.isAnalysisCancellationRequested(jobId)) {
        store.finishAnalysisJob(jobId, "cancelled");
        return;
      }
      const item = store.claimNextAnalysisItem(jobId);
      if (!item) {
        store.finishAnalysisJob(jobId, "completed");
        return;
      }
      if (!existsSync(item.path)) {
        store.failAnalysisItem(item, "图片文件不存在");
        continue;
      }
      const cached = store.getCachedAssetAnalysis(item.assetId, item.assetUpdatedAt, client.engine);
      if (cached) {
        store.completeAnalysisItem(item, cached, true);
        continue;
      }
      try {
        const assessment = await client.classify(item.path, 30_000);
        if (assessment.status === "error") store.failAnalysisItem(item, assessment.error ?? "模型分析失败");
        else store.completeAnalysisItem(item, assessment, false);
      } catch (error) {
        store.failAnalysisItem(item, messageFrom(error));
      }
    }
  } catch (error) {
    store.finishAnalysisJob(jobId, "failed", messageFrom(error));
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "未知分析错误");
}
