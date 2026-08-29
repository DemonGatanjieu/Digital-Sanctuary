import type { VisionSuiteDefinition } from "@sanctuary/domain";
import type { PreparedVisionImage } from "../vision-image-preprocessor.js";
import type { ExternalVisionAdapter, ExternalVisionAdapterResult } from "./types.js";
import { createEvaluationPrompt, validateEvaluationDimensions } from "./evaluation-contract.js";

export class OpenAiVisionAdapter implements ExternalVisionAdapter {
  readonly providerId: string;
  readonly #isCompatibleMode: boolean;

  constructor(providerId = "openai", isCompatibleMode = false) {
    this.providerId = providerId;
    this.#isCompatibleMode = isCompatibleMode;
  }

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
        summary: "未提供 API Key"
      };
    }

    const endpoint = input.endpoint?.trim() || "https://api.openai.com/v1";
    const url = `${endpoint.replace(/\/+$/, "")}/chat/completions`;

    const systemPrompt = createEvaluationPrompt(input.suite);

    const base64Data = `data:${input.image.mimeType};base64,${input.image.buffer.toString("base64")}`;
    const payload = {
      model: input.model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: `Please evaluate this artwork according to ${input.suite.name}. All dimension scores must be numbers between 0 and 100.` },
            { type: "image_url", image_url: { url: base64Data, detail: "high" } }
          ]
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 800
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
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${input.apiKey}`
          },
          body: JSON.stringify(payload),
          signal: input.signal ?? null
        });

        if (!response.ok) {
          const status = response.status;
          const errorBody = await response.text().catch(() => "");

          if (status === 401 || status === 403) {
            return {
              status: "auth_error",
              dimensions: [],
              reasonCode: "unauthorized",
              summary: "API 密钥无效或无权限访问该模型"
            };
          }

          if (status === 429) {
            if (attempt < maxRetries) {
              const retryAfter = Number(response.headers.get("retry-after") || "1");
              await delay(Math.min(5000, Math.max(1000, retryAfter * 1000)));
              attempt++;
              continue;
            }
            return {
              status: "rate_limited",
              dimensions: [],
              reasonCode: "rate_limit_exceeded",
              summary: "服务商请求频次超限或配额不足"
            };
          }

          if (status === 400 && /safety|content_policy|moderation/i.test(errorBody)) {
            return {
              status: "content_blocked",
              dimensions: [],
              reasonCode: "safety_filter_triggered",
              summary: "图片触发服务商安全审查"
            };
          }

          if (status >= 500 && attempt < maxRetries) {
            await delay(1000 * Math.pow(2, attempt));
            attempt++;
            continue;
          }

          return {
            status: "network_error",
            dimensions: [],
            reasonCode: `http_${status}`,
            summary: `服务商返回 HTTP ${status}`
          };
        }

        const data: any = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
          return {
            status: "invalid_response",
            dimensions: [],
            reasonCode: "empty_completion",
            summary: "服务商未返回有效内容"
          };
        }

        let parsed: any;
        try {
          parsed = JSON.parse(content);
        } catch {
          return {
            status: "invalid_response",
            dimensions: [],
            reasonCode: "json_parse_error",
            summary: "模型返回的内容非合规 JSON"
          };
        }

        const validation = validateEvaluationDimensions(parsed.dimensions, input.suite);
        if (!validation.valid || !validation.normalized) {
          return {
            status: "invalid_response",
            dimensions: [],
            reasonCode: "schema_validation_failed",
            summary: "模型这次没有返回完整可用的维度评分，请重新分析一次。"
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
            promptTokens: data?.usage?.prompt_tokens,
            completionTokens: data?.usage?.completion_tokens
          }
        };
      } catch (error) {
        if (input.signal?.aborted) {
          return { status: "cancelled", dimensions: [], reasonCode: "cancelled" };
        }
        if (attempt < maxRetries) {
          await delay(1000 * Math.pow(2, attempt));
          attempt++;
          continue;
        }
        return {
          status: "network_error",
          dimensions: [],
          reasonCode: "connection_error",
          summary: error instanceof Error ? error.message : "网络连接异常"
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
