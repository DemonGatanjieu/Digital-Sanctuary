import type {
  VisionDimensionScore,
  VisionEvaluationStatus,
  VisionSuiteDefinition
} from "@sanctuary/domain";
import type { PreparedVisionImage } from "../vision-image-preprocessor.js";
import type { ExternalVisionAdapter, ExternalVisionAdapterResult } from "./types.js";

export type FakeAdapterMode =
  | "success"
  | "rate_limited"
  | "content_blocked"
  | "auth_error"
  | "timeout"
  | "invalid_response";

export class FakeVisionAdapter implements ExternalVisionAdapter {
  readonly providerId = "fake";
  #mode: FakeAdapterMode = "success";
  #customScores?: Record<string, number>;

  setMode(mode: FakeAdapterMode): void {
    this.#mode = mode;
  }

  setCustomScores(scores: Record<string, number>): void {
    this.#customScores = scores;
  }

  async analyze(input: {
    image: PreparedVisionImage;
    suite: VisionSuiteDefinition;
    model: string;
    apiKey: string;
    endpoint?: string;
    signal?: AbortSignal;
  }): Promise<ExternalVisionAdapterResult> {
    if (input.signal?.aborted) {
      return {
        status: "cancelled",
        dimensions: [],
        reasonCode: "cancelled"
      };
    }

    if (this.#mode === "auth_error") {
      return {
        status: "auth_error",
        dimensions: [],
        reasonCode: "invalid_api_key",
        summary: "API 密钥无效或未授权"
      };
    }

    if (this.#mode === "rate_limited") {
      return {
        status: "rate_limited",
        dimensions: [],
        reasonCode: "rate_limit_exceeded",
        summary: "请求频次超限 (Rate Limited)"
      };
    }

    if (this.#mode === "content_blocked") {
      return {
        status: "content_blocked",
        dimensions: [],
        reasonCode: "safety_filter_triggered",
        summary: "图片触发服务商安全审查"
      };
    }

    if (this.#mode === "invalid_response") {
      return {
        status: "invalid_response",
        dimensions: [],
        reasonCode: "schema_validation_failed",
        summary: "模型返回了无效的响应格式"
      };
    }

    // Deterministic mock generation based on suite dimensions & image length
    const dimensions: VisionDimensionScore[] = input.suite.dimensions.map((dim, idx) => {
      const customScore = this.#customScores?.[dim.key];
      const score = customScore !== undefined
        ? customScore
        : ((input.image.byteLength * (idx + 1) * 31) % 50) + 45;

      return {
        key: dim.key,
        label: dim.label,
        score: Math.round(score * 100) / 100,
        explanation: `由 ${input.model} 评估：${dim.label}表现良好`
      };
    });

    return {
      status: "success",
      dimensions,
      summary: `由 ${input.model} 解读：整体构思完整，符合 ${input.suite.name} 特征。`,
      rawUsage: {
        promptTokens: 420,
        completionTokens: 85
      }
    };
  }
}
