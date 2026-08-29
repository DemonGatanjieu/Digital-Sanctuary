import type { VisionSuiteDefinition } from "@sanctuary/domain";
import type { PreparedVisionImage } from "../vision-image-preprocessor.js";
import type { ExternalVisionAdapter, ExternalVisionAdapterResult } from "./types.js";
import { createEvaluationPrompt, validateEvaluationDimensions } from "./evaluation-contract.js";

export class GeminiVisionAdapter implements ExternalVisionAdapter {
  readonly providerId = "gemini";

  async analyze(input: {
    image: PreparedVisionImage;
    suite: VisionSuiteDefinition;
    model: string;
    apiKey: string;
    endpoint?: string | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<ExternalVisionAdapterResult> {
    if (!input.apiKey) {
      return {
        status: "auth_error",
        dimensions: [],
        reasonCode: "missing_api_key",
        summary: "未提供 Gemini API Key"
      };
    }

    const modelName = input.model || "gemini-1.5-flash";
    const baseUrl = input.endpoint?.trim() || "https://generativelanguage.googleapis.com";
    const url = `${baseUrl.replace(/\/+$/, "")}/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(input.apiKey)}`;

    const promptText = createEvaluationPrompt(input.suite);

    const payload = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inline_data: {
                mime_type: input.image.mimeType,
                data: input.image.buffer.toString("base64")
              }
            }
          ]
        }
      ],
      generationConfig: {
        response_mime_type: "application/json",
        temperature: 0.2
      }
    };

    let attempt = 0;
    const maxRetries = 2;

    while (attempt <= maxRetries) {
      if (input.signal?.aborted) {
        return { status: "cancelled", dimensions: [], reasonCode: "cancelled" };
      }

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: input.signal ?? null
        });

        if (!response.ok) {
          const status = response.status;
          const errorText = await response.text().catch(() => "");

          if (status === 400 && /API_KEY_INVALID|KEY_EXPIRED/i.test(errorText)) {
            return {
              status: "auth_error",
              dimensions: [],
              reasonCode: "invalid_api_key",
              summary: "Gemini API Key 无效或已过期"
            };
          }

          if (status === 429) {
            if (attempt < maxRetries) {
              await delay(2000 * Math.pow(2, attempt));
              attempt++;
              continue;
            }
            return {
              status: "rate_limited",
              dimensions: [],
              reasonCode: "quota_exhausted",
              summary: "Gemini 请求频次超限或配额耗尽"
            };
          }

          if (status >= 500 && attempt < maxRetries) {
            await delay(1500 * Math.pow(2, attempt));
            attempt++;
            continue;
          }

          return {
            status: "network_error",
            dimensions: [],
            reasonCode: `http_${status}`,
            summary: `Gemini 返回 HTTP ${status}`
          };
        }

        const data: any = await response.json();

        // Check safety block
        if (data?.promptFeedback?.blockReason) {
          return {
            status: "content_blocked",
            dimensions: [],
            reasonCode: `safety_${data.promptFeedback.blockReason.toLowerCase()}`,
            summary: "图片触发 Gemini 安全过滤策略"
          };
        }

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          return {
            status: "invalid_response",
            dimensions: [],
            reasonCode: "empty_candidate",
            summary: "Gemini 未返回有效的候选文本"
          };
        }

        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch {
          return {
            status: "invalid_response",
            dimensions: [],
            reasonCode: "json_parse_error",
            summary: "Gemini 返回内容无法解析为 JSON"
          };
        }

        const validation = validateEvaluationDimensions(parsed.dimensions, input.suite);
        if (!validation.valid || !validation.normalized) {
          return {
            status: "invalid_response",
            dimensions: [],
            reasonCode: "schema_validation_failed",
            summary: `返回维度评分不符合套件规范: ${validation.errors?.join(", ")}`
          };
        }

        const summary = typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 300)
          : undefined;

        return {
          status: "success",
          dimensions: validation.normalized,
          summary,
          rawUsage: {
            promptTokens: data?.usageMetadata?.promptTokenCount,
            completionTokens: data?.usageMetadata?.candidatesTokenCount
          }
        };
      } catch (error) {
        if (input.signal?.aborted) {
          return { status: "cancelled", dimensions: [], reasonCode: "cancelled" };
        }
        if (attempt < maxRetries) {
          await delay(1500 * Math.pow(2, attempt));
          attempt++;
          continue;
        }
        return {
          status: "network_error",
          dimensions: [],
          reasonCode: "connection_error",
          summary: error instanceof Error ? error.message : "Gemini 网络请求异常"
        };
      }
    }

    return {
      status: "network_error",
      dimensions: [],
      reasonCode: "retries_exhausted",
      summary: "重试次数已耗尽"
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
