export interface ComfyUiConfig {
  enabled: boolean;
  baseUrl: string;
}

export interface ComfyWorkflowTemplateSummary {
  id: string;
  name: string;
  nodeCount: number;
  hasPositiveBinding: boolean;
  hasNegativeBinding: boolean;
  hasSourceImageBinding: boolean;
  createdAt: string;
}

export interface ComfyWorkflowTemplate extends ComfyWorkflowTemplateSummary {
  workflow: Record<string, unknown>;
}

export type ComfyUiJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ComfyUiJob {
  id: string;
  status: ComfyUiJobStatus;
  sourceWorkId: string;
  sourceAssetId: string;
  templateId: string;
  templateName: string;
  positivePrompt: string;
  negativePrompt: string;
  remotePromptId: string | null;
  outputWorkId: string | null;
  workflowSummary: Record<string, unknown>;
  parameters: Record<string, unknown>;
  error: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ComfyUiSendRequest {
  workId: string;
  pageIndex: number;
  templateId: string;
  positivePrompt: string;
  negativePrompt: string;
}

export interface GenerationProvenance {
  outputWorkId: string;
  sourceWorkId: string;
  sourceAssetId: string;
  provider: "comfyui";
  templateName: string;
  positivePrompt: string;
  negativePrompt: string;
  workflowSummary: Record<string, unknown>;
  parameters: Record<string, unknown>;
  createdAt: string;
}

export const DEFAULT_COMFY_UI_CONFIG: ComfyUiConfig = {
  enabled: false,
  baseUrl: "http://127.0.0.1:8188"
};

export function isComfyUiSendRequest(value: unknown): value is ComfyUiSendRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<ComfyUiSendRequest>;
  return typeof input.workId === "string" && input.workId.length > 0 && input.workId.length <= 200 &&
    Number.isInteger(input.pageIndex) && (input.pageIndex ?? -1) >= 0 && (input.pageIndex ?? 0) <= 10_000 &&
    typeof input.templateId === "string" && input.templateId.length > 0 && input.templateId.length <= 100 &&
    typeof input.positivePrompt === "string" && input.positivePrompt.length <= 100_000 &&
    typeof input.negativePrompt === "string" && input.negativePrompt.length <= 100_000;
}

export function summarizeComfyWorkflowTemplate(template: ComfyWorkflowTemplate): ComfyWorkflowTemplateSummary {
  const { workflow: _workflow, ...summary } = template;
  return summary;
}
