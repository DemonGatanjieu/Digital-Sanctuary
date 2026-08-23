import type { VisionAssessment, VisionDimensionScore } from "@sanctuary/domain";

export const VISION_PROTOCOL_VERSION = 1 as const;

export interface ClassifyImageRequest {
  version: typeof VISION_PROTOCOL_VERSION;
  id: string;
  type: "classify-image";
  payload: {
    imagePath: string;
  };
}

export interface ClassifyImageResponse {
  version: typeof VISION_PROTOCOL_VERSION;
  id: string;
  type: "classify-image-result";
  payload: VisionAssessment;
}

export interface TechnicalProfilePayload {
  status: "success" | "unsupported" | "error";
  suiteId: "technical_visual_v1";
  suiteVersion: 1;
  evaluatorVersion: string;
  dimensions: VisionDimensionScore[];
  elapsedMs: number;
  reasonCode?: string;
  error?: string;
}

export interface ComputeTechnicalProfileRequest {
  version: typeof VISION_PROTOCOL_VERSION;
  id: string;
  type: "compute-technical-profile";
  payload: {
    imagePath: string;
  };
}

export interface ComputeTechnicalProfileResponse {
  version: typeof VISION_PROTOCOL_VERSION;
  id: string;
  type: "compute-technical-profile-result";
  payload: TechnicalProfilePayload;
}

export interface VisionHealthRequest {
  version: typeof VISION_PROTOCOL_VERSION;
  id: string;
  type: "health-check";
  payload: Record<string, never>;
}

export interface VisionHealthPayload {
  status: "ready";
  engine: string;
  engineVersion: string;
  executionProvider?: string;
}

export interface VisionHealthResponse {
  version: typeof VISION_PROTOCOL_VERSION;
  id: string;
  type: "health-check-result";
  payload: VisionHealthPayload;
}

export interface VisionErrorResponse {
  version: typeof VISION_PROTOCOL_VERSION;
  id: string;
  type: "error";
  payload: {
    code: string;
    message: string;
  };
}

export type VisionRequest =
  | ClassifyImageRequest
  | ComputeTechnicalProfileRequest
  | VisionHealthRequest;

export type VisionResponse =
  | ClassifyImageResponse
  | ComputeTechnicalProfileResponse
  | VisionHealthResponse
  | VisionErrorResponse;

export function isVisionRequest(value: unknown): value is VisionRequest {
  if (!isRecord(value) || value.version !== VISION_PROTOCOL_VERSION) return false;
  if (typeof value.id !== "string") return false;
  if (!isRecord(value.payload)) return false;
  if (value.type === "health-check") return true;
  if (value.type !== "classify-image" && value.type !== "compute-technical-profile") return false;
  return typeof value.payload.imagePath === "string";
}

export function isVisionResponse(value: unknown): value is VisionResponse {
  if (!isRecord(value) || value.version !== VISION_PROTOCOL_VERSION) return false;
  if (typeof value.id !== "string" || !isRecord(value.payload)) return false;
  return (
    value.type === "classify-image-result" ||
    value.type === "compute-technical-profile-result" ||
    value.type === "health-check-result" ||
    value.type === "error"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
