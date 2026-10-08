import type { AnalysisScope } from "./index.js";

export type ImageTarget = { workId: string; assetId?: string } | { sessionId: string; itemId: string };
export interface ImageExportItem { id: string; target: ImageTarget; fileName: string; status: "pending" | "copied" | "failed" | "cancelled"; error?: string }
export interface ImageExportBatch { id: string; phase: "running" | "completed" | "cancelled"; cancelRequested: boolean; items: ImageExportItem[] }
export type WorkbenchSource = "folder" | "library";
export type WorkbenchMode = "rules" | "elements" | "description";
export interface WorkbenchQuery { mode: WorkbenchMode; text: string; include: string[]; exclude: string[] }
export interface WorkbenchItem {
  id: string; fileName: string; title: string; previewUrl: string; target: ImageTarget;
  status: "pending" | "ready" | "failed"; error?: string; score?: number; matched?: boolean; matchedTags?: string[];
}
export interface WorkbenchSnapshot {
  id: string; source: WorkbenchSource; name: string; recursive: boolean; scope?: AnalysisScope;
  phase: "scanning" | "ready" | "analyzing" | "completed" | "cancelled" | "failed";
  cancelRequested: boolean;
  total: number; processed: number; failed: number; matched: number; unanalysed: number;
  visited: number; limitReached: boolean; warnings: string[]; error?: string; query?: WorkbenchQuery;
  items: WorkbenchItem[]; hasMore: boolean; engine?: string;
}
export interface SemanticAvailability { available: boolean; model: string; device: "cpu"; message: string }
export interface ImageTaskSummary {
  id: string; kind: "workbench" | "copy"; source: WorkbenchSource; name: string;
  phase: string; total: number; processed: number; failed: number; cancelRequested: boolean;
}
