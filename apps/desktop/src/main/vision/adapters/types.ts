import type {
  VisionDimensionScore,
  VisionEvaluationStatus,
  VisionSuiteDefinition
} from "@sanctuary/domain";
import type { PreparedVisionImage } from "../vision-image-preprocessor.js";

export interface ExternalVisionAdapterResult {
  status: VisionEvaluationStatus;
  dimensions: VisionDimensionScore[];
  summary?: string | undefined;
  reasonCode?: string | undefined;
  rawUsage?: {
    promptTokens?: number | undefined;
    completionTokens?: number | undefined;
  } | undefined;
}

export interface ExternalVisionAdapter {
  readonly providerId: string;
  analyze(input: {
    image: PreparedVisionImage;
    suite: VisionSuiteDefinition;
    model: string;
    apiKey: string;
    endpoint?: string | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<ExternalVisionAdapterResult>;
}
