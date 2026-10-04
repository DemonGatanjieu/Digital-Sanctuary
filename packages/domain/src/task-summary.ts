import type { AnalysisJobStatus, AnalysisScope } from "./index.js";
export interface AnalysisTaskSummary {
  id: string;
  status: AnalysisJobStatus;
  scopeType: AnalysisScope["type"];
  engine: string;
  workCount: number;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  cancelRequested: boolean;
  error: string | null;
  createdAt: string;
}
