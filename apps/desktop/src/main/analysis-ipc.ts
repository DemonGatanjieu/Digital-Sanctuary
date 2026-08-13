import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import { isAnalysisScope, type AnalysisApplyResult, type AnalysisJob, type AnalysisScopePreview } from "@sanctuary/domain";
import type { VisionClient } from "./vision-client.js";
import type { AnalysisJobScheduler } from "./analysis-job-runner.js";

export function registerAnalysisIpc(ipc: IpcMain, database: LibraryDatabase, vision: VisionClient, scheduler: AnalysisJobScheduler): void {
  ipc.handle("analysis:preview", (_event, value: unknown): AnalysisScopePreview => {
    if (!isAnalysisScope(value)) throw new Error("Invalid analysis scope");
    return database.previewAnalysisScope(value, vision.engine);
  });
  ipc.handle("analysis:create", (_event, value: unknown): AnalysisJob => {
    if (!isAnalysisScope(value)) throw new Error("Invalid analysis scope");
    return database.createAnalysisJob(value, vision.engine);
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
    if (typeof candidate.jobId !== "string" || candidate.jobId.length > 100 ||
        !Array.isArray(candidate.suggestionIds) || candidate.suggestionIds.length > 12 ||
        !candidate.suggestionIds.every((id) => typeof id === "string" && id.length <= 200)) {
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
      const collection = database.listCollections().find((item) => item.name === name) ??
        database.createCollection(name, `由 ${job.engine} 建议；需由用户明确确认后加入。`);
      collectionIds.push(collection.id);
      for (const workId of suggestion.workIds) {
        database.addWorkToCollection(workId, collection.id);
        affected.add(workId);
      }
    }
    return { collectionIds, affectedWorkCount: affected.size };
  });
}
