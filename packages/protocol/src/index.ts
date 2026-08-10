import type { VisionAssessment } from "@sanctuary/domain";

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

export interface VisionErrorResponse {
  version: typeof VISION_PROTOCOL_VERSION;
  id: string;
  type: "error";
  payload: {
    code: string;
    message: string;
  };
}

export type VisionRequest = ClassifyImageRequest;
export type VisionResponse = ClassifyImageResponse | VisionErrorResponse;

export function isVisionRequest(value: unknown): value is VisionRequest {
  if (!isRecord(value) || value.version !== VISION_PROTOCOL_VERSION) return false;
  if (typeof value.id !== "string" || value.type !== "classify-image") return false;
  return isRecord(value.payload) && typeof value.payload.imagePath === "string";
}

export function isVisionResponse(value: unknown): value is VisionResponse {
  if (!isRecord(value) || value.version !== VISION_PROTOCOL_VERSION) return false;
  if (typeof value.id !== "string" || !isRecord(value.payload)) return false;
  return value.type === "classify-image-result" || value.type === "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

