import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import {
  getVisionSuite,
  isAnalysisScope,
  type AnalysisApplyResult,
  type AnalysisJob,
  type AnalysisScopePreview,
  type ExternalVisionPublicConfig,
  type VisionEvaluationRequest,
  type VisionEvaluationResult
} from "@sanctuary/domain";
import type { VisionClient } from "./vision-client.js";
import type { AnalysisJobScheduler } from "./analysis-job-runner.js";
import type { ExternalVisionService } from "./vision/external-vision-service.js";
import { prepareVisionImage } from "./vision/vision-image-preprocessor.js";
import { parseWorkId } from "../shared/library-query.js";

export function registerAnalysisIpc(
  ipc: IpcMain,
  database: LibraryDatabase,
  vision: VisionClient,
  scheduler: AnalysisJobScheduler,
  externalVisionService?: ExternalVisionService
): void {
  ipc.handle("analysis:preview", (_event, value: unknown, engineValue?: unknown): AnalysisScopePreview => {
    if (!isAnalysisScope(value)) throw new Error("Invalid analysis scope");
    const engine = typeof engineValue === "string" && engineValue ? engineValue : vision.engine;
    return database.previewAnalysisScope(value, engine);
  });

  ipc.handle("analysis:create", (_event, value: unknown, engineValue?: unknown): AnalysisJob => {
    if (!isAnalysisScope(value)) throw new Error("Invalid analysis scope");
    const engine = typeof engineValue === "string" && engineValue ? engineValue : vision.engine;
    return database.createAnalysisJob(value, engine);
  });

  ipc.handle("analysis:list", (): AnalysisJob[] => database.listAnalysisJobs());

  ipc.handle("analysis:start", (_event, value: unknown): AnalysisJob => {
    if (typeof value !== "string" || value.length > 100) throw new Error("Invalid analysis job");
    const job = database.getAnalysisJob(value);
    if (!job || job.status !== "queued") throw new Error("Analysis job is not queued");
    scheduler.schedule(job.id, database, vision);
    return job;
  });

  ipc.handle("analysis:cancel", (_event, value: unknown): AnalysisJob => {
    if (typeof value !== "string" || value.length > 100) throw new Error("Invalid analysis job");
    if (!database.requestAnalysisCancellation(value)) throw new Error("Analysis job cannot be cancelled");
    return database.getAnalysisJob(value)!;
  });

  ipc.handle("analysis:apply-suggestions", (_event, value: unknown): AnalysisApplyResult => {
    if (!value || typeof value !== "object") throw new Error("Invalid suggestion request");
    const candidate = value as { jobId?: unknown; suggestionIds?: unknown };
    if (
      typeof candidate.jobId !== "string" ||
      candidate.jobId.length > 100 ||
      !Array.isArray(candidate.suggestionIds) ||
      candidate.suggestionIds.length > 12 ||
      !candidate.suggestionIds.every((id) => typeof id === "string" && id.length <= 200)
    ) {
      throw new Error("Invalid suggestion request");
    }
    const suggestionIds = candidate.suggestionIds as string[];
    const job = database.getAnalysisJob(candidate.jobId);
    if (!job || job.status !== "completed") throw new Error("Analysis job is not complete");
    const selected = job.suggestions.filter((suggestion) => suggestionIds.includes(suggestion.id));
    const affected = new Set<string>();
    const collectionIds: string[] = [];
    for (const suggestion of selected) {
      const name = `AI · ${suggestion.label.replaceAll("_", " ")}`.slice(0, 80);
      const collection =
        database.listCollections().find((item) => item.name === name) ??
        database.createCollection(name, `由 ${job.engine} 建议；需由用户明确确认后加入。`);
      collectionIds.push(collection.id);
      for (const workId of suggestion.workIds) {
        database.addWorkToCollection(workId, collection.id);
        affected.add(workId);
      }
    }
    return { collectionIds, affectedWorkCount: affected.size };
  });

  ipc.handle("analysis:triage-query", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid triage query payload");
    const { tags, minConfidence, scope } = payload as { tags?: unknown; minConfidence?: unknown; scope?: unknown };
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) {
      throw new Error("Invalid tags list for triage");
    }
    const safeConfidence = typeof minConfidence === "number" && minConfidence >= 0.05 && minConfidence <= 0.95
      ? minConfidence
      : 0.4;
    const safeScope = isAnalysisScope(scope) ? scope : undefined;
    return database.queryWorksByTags(tags, safeConfidence, safeScope);
  });

  // Vision & External AI Radar Handlers
  ipc.handle("vision:get-config", (_event, providerId: unknown): ExternalVisionPublicConfig => {
    if (typeof providerId !== "string" || !externalVisionService) {
      throw new Error("Invalid provider or service unavailable");
    }
    return externalVisionService.getPublicConfig(providerId);
  });

  ipc.handle("vision:save-config", (_event, config: unknown, newApiKey?: unknown): ExternalVisionPublicConfig => {
    if (!config || typeof config !== "object" || !externalVisionService) {
      throw new Error("Invalid config or service unavailable");
    }
    const safeConfig = config as ExternalVisionPublicConfig;
    const apiKey = typeof newApiKey === "string" ? newApiKey : undefined;
    externalVisionService.savePublicConfig(safeConfig, apiKey);
    return externalVisionService.getPublicConfig(safeConfig.provider);
  });

  ipc.handle("vision:delete-key", (_event, providerId: unknown): void => {
    if (typeof providerId !== "string" || !externalVisionService) {
      throw new Error("Invalid provider or service unavailable");
    }
    externalVisionService.deleteApiKey(providerId);
  });

  ipc.handle("vision:test-connection", async (_event, providerId: unknown) => {
    if (typeof providerId !== "string" || !externalVisionService) {
      throw new Error("Invalid provider or service unavailable");
    }
    return externalVisionService.testConnection(providerId);
  });

  ipc.handle("vision:list-evaluations", (_event, workIdValue: unknown): VisionEvaluationResult[] => {
    const workId = parseWorkId(workIdValue);
    if (!workId) return [];
    return database.listVisionEvaluationsForWork(workId);
  });

  ipc.handle("vision:evaluate-work", async (_event, value: unknown): Promise<VisionEvaluationResult> => {
    const request = parseVisionEvaluationRequest(value);
    return evaluateWorkVision(request, database, vision, externalVisionService);
  });
}

export async function evaluateWorkVision(
  request: VisionEvaluationRequest,
  database: LibraryDatabase,
  vision: VisionClient,
  externalVisionService?: ExternalVisionService
): Promise<VisionEvaluationResult> {
  const suite = getVisionSuite(request.suiteId);
  if (!suite) throw new Error("未知的视觉评价方案");

  const work = database.getWork(request.workId);
  if (!work) throw new Error("画廊中找不到这件作品");
  const asset =
    (work.coverAssetId ? work.assets.find((candidate) => candidate.id === work.coverAssetId) : undefined) ??
    work.assets.find((candidate) => candidate.mediaType === "image" && candidate.fileState === "available") ??
    work.assets[0];
  if (!asset || asset.mediaType !== "image" || asset.fileState !== "available" || !existsSync(asset.path)) {
    throw new Error("作品原图不在本地，暂时无法生成画像");
  }

  if (suite.kind === "local_technical_profile") {
    const fingerprint = "technical_profile_v1";
    if (!request.force) {
      const cached = database.getCachedVisionEvaluation(
        asset.id,
        suite.kind,
        suite.id,
        suite.version,
        fingerprint,
        asset.updatedAt
      );
      if (cached) return cached;
    }
    const profile = await vision.computeTechnicalProfile(asset.path, 30_000);
    if (profile.status !== "success") throw new Error(profile.error ?? "本地技术画像计算失败");
    const now = new Date().toISOString();
    const result: VisionEvaluationResult = {
      id: randomUUID(),
      workId: work.id,
      assetId: asset.id,
      scope: "cover_asset",
      kind: suite.kind,
      suiteId: suite.id,
      suiteVersion: suite.version,
      status: "success",
      dimensions: profile.dimensions,
      evaluatorVersion: profile.evaluatorVersion,
      preprocessingFingerprint: fingerprint,
      assetVersion: asset.updatedAt,
      createdAt: now,
      updatedAt: now
    };
    database.saveVisionEvaluationResult(result);
    return result;
  }

  if (suite.kind !== "external_fixed_suite" || !externalVisionService) {
    throw new Error("这个评价方案的运行时尚未接通");
  }
  if (!request.providerId) throw new Error("请选择一个视觉评论模型");
  const config = externalVisionService.getPublicConfig(request.providerId);
  if (!config.enabled) throw new Error("该视觉评论模型尚未启用，请先在设置中完成连接");

  const prepared = await prepareVisionImage(asset.path, { maxLongEdge: config.maxLongEdge });
  const fingerprint = `${prepared.fingerprint}:${request.providerId}:${config.model}`;
  try {
    if (!request.force) {
      const cached = database.getCachedVisionEvaluation(
        asset.id,
        suite.kind,
        suite.id,
        suite.version,
        fingerprint,
        asset.updatedAt
      );
      if (cached) return cached;
    }
    const evaluated = await externalVisionService.analyzeImage(request.providerId, prepared, suite);
    const now = new Date().toISOString();
    const result: VisionEvaluationResult = {
      id: randomUUID(),
      workId: work.id,
      assetId: asset.id,
      scope: "cover_asset",
      kind: suite.kind,
      suiteId: suite.id,
      suiteVersion: suite.version,
      status: evaluated.status,
      dimensions: evaluated.dimensions,
      evaluatorVersion: `${request.providerId}:${config.model}`,
      preprocessingFingerprint: fingerprint,
      assetVersion: asset.updatedAt,
      createdAt: now,
      updatedAt: now,
      ...(evaluated.reasonCode ? { reasonCode: evaluated.reasonCode } : {}),
      ...(evaluated.summary ? { summary: evaluated.summary } : {}),
      providerId: request.providerId,
      modelId: config.model,
      promptVersion: `${suite.id}@v${suite.version}`
    };
    if (result.status === "success") database.saveVisionEvaluationResult(result);
    return result;
  } finally {
    prepared.cleanup();
  }
}

function parseVisionEvaluationRequest(value: unknown): VisionEvaluationRequest {
  if (!value || typeof value !== "object") throw new Error("无效的视觉评价请求");
  const candidate = value as Record<string, unknown>;
  const workId = parseWorkId(candidate.workId);
  if (!workId || typeof candidate.suiteId !== "string" || candidate.suiteId.length > 80) {
    throw new Error("无效的视觉评价请求");
  }
  const providerId = typeof candidate.providerId === "string" ? candidate.providerId : undefined;
  if (providerId && !["openai", "gemini", "anthropic", "openai_compatible"].includes(providerId)) {
    throw new Error("不支持的视觉评论模型");
  }
  return {
    workId,
    suiteId: candidate.suiteId,
    ...(providerId ? { providerId: providerId as VisionEvaluationRequest["providerId"] } : {}),
    force: candidate.force === true
  };
}
