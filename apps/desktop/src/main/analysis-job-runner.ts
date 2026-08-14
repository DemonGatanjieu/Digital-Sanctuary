import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { AnalysisQueueItem } from "@sanctuary/database";
import type {
  AnalysisJobStatus,
  VisionAssessment,
  VisionEvaluationResult
} from "@sanctuary/domain";
import type { TechnicalProfilePayload } from "@sanctuary/protocol";

export interface AnalysisJobStore {
  isAnalysisCancellationRequested(jobId: string): boolean;
  startAnalysisJob(jobId: string): boolean;
  claimNextAnalysisItem(jobId: string): AnalysisQueueItem | null;
  getCachedAssetAnalysis(assetId: string, assetUpdatedAt: string, engine: string): VisionAssessment | null;
  getCachedVisionEvaluation?(
    assetId: string,
    kind: string,
    suiteId: string,
    suiteVersion: number,
    fingerprint: string,
    assetVersion: string
  ): VisionEvaluationResult | null;
  saveVisionEvaluationResult?(result: VisionEvaluationResult): void;
  completeAnalysisItem(item: AnalysisQueueItem, assessment: VisionAssessment, cached: boolean): void;
  failAnalysisItem(item: AnalysisQueueItem, error: string): void;
  finishAnalysisJob(jobId: string, status: Extract<AnalysisJobStatus, "completed" | "cancelled" | "failed">, error?: string | null): void;
}

export interface AnalysisVisionClient {
  engine: string;
  classify(path: string, timeoutMs?: number): Promise<VisionAssessment>;
  computeTechnicalProfile?(path: string, timeoutMs?: number): Promise<TechnicalProfilePayload>;
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
    const isTechnicalVisual = client.engine === "technical_visual_v1" || client.engine.startsWith("technical_visual_");

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

      if (isTechnicalVisual && client.computeTechnicalProfile) {
        const cached = store.getCachedVisionEvaluation?.(
          item.assetId,
          "local_technical_profile",
          "technical_visual_v1",
          1,
          "none",
          item.assetUpdatedAt
        );
        if (cached) {
          store.completeAnalysisItem(item, createDummyAssessment(cached), true);
          continue;
        }

        try {
          const profile = await client.computeTechnicalProfile(item.path, 30_000);
          if (profile.status === "error") {
            store.failAnalysisItem(item, profile.error ?? "技术画像计算失败");
          } else {
            const result: VisionEvaluationResult = {
              id: randomUUID(),
              workId: item.workId,
              assetId: item.assetId,
              scope: "cover_asset",
              kind: "local_technical_profile",
              suiteId: "technical_visual_v1",
              suiteVersion: 1,
              status: "success",
              dimensions: profile.dimensions,
              evaluatorVersion: profile.evaluatorVersion,
              preprocessingFingerprint: "none",
              assetVersion: item.assetUpdatedAt,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            store.saveVisionEvaluationResult?.(result);
            store.completeAnalysisItem(item, createDummyAssessment(result), false);
          }
        } catch (error) {
          store.failAnalysisItem(item, messageFrom(error));
        }
      } else {
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
    }
  } catch (error) {
    store.finishAnalysisJob(jobId, "failed", messageFrom(error));
  }
}

function createDummyAssessment(evalResult: VisionEvaluationResult): VisionAssessment {
  const labels: Record<string, number> = {};
  for (const d of evalResult.dimensions) {
    labels[d.key] = d.score / 100;
  }
  return {
    status: "complete",
    engine: evalResult.suiteId,
    engineVersion: `v${evalResult.suiteVersion}`,
    labels,
    elapsedMs: 1
  };
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "未知分析错误");
}
