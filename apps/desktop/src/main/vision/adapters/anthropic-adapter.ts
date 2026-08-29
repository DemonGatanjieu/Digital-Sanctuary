import type { VisionSuiteDefinition } from "@sanctuary/domain";
import type { PreparedVisionImage } from "../vision-image-preprocessor.js";
import type { ExternalVisionAdapter, ExternalVisionAdapterResult } from "./types.js";
import { createEvaluationPrompt, normalizeImageReading, validateEvaluationDimensions } from "./evaluation-contract.js";

export class AnthropicVisionAdapter implements ExternalVisionAdapter {
  readonly providerId = "anthropic";

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
        summary: "未提供 Anthropic API Key"
      };
    }

    const modelName = input.model || "claude-3-5-sonnet-20241022";
    const baseUrl = input.endpoint?.trim() || "https://api.anthropic.com";
    const url = `${baseUrl.replace(/\/+$/, "")}/v1/messages`;

    const promptText = `${createEvaluationPrompt(input.suite)}\nYou MUST respond with only the raw JSON object and no markdown code fences.`;

    const payload = {
      model: modelName,
      max_tokens: 1600,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.image.mimeType,
                data: input.image.buffer.toString("base64")
              }
            },
            {
              type: "text",
              text: promptText
            }
          ]
        }
      ]
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
            "x-api-key": input.apiKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify(payload),
          signal: input.signal ?? null
        });

        if (!response.ok) {
          const status = response.status;
          const errorText = await response.text().catch(() => "");

          if (status === 401 || status === 403) {
            return {
              status: "auth_error",
              dimensions: [],
              reasonCode: "unauthorized",
              summary: "Anthropic API Key 无效或未授权"
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
              reasonCode: "rate_limit_exceeded",
              summary: "Claude 请求频次超限"
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
            summary: `Anthropic 返回 HTTP ${status}: ${errorText.slice(0, 100)}`
          };
        }

        const data: any = await response.json();
        const text = data?.content?.find((c: any) => c.type === "text")?.text;
        if (!text) {
          return {
            status: "invalid_response",
            dimensions: [],
            reasonCode: "empty_content",
            summary: "Claude 未返回有效文本"
          };
        }

        // Clean any markdown code fences if model enclosed them
        const cleanJson = text.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();

        let parsed: any;
        try {
          parsed = JSON.parse(cleanJson);
        } catch {
          return {
            status: "invalid_response",
            dimensions: [],
            reasonCode: "json_parse_error",
            summary: "Claude 返回内容无法解析为 JSON"
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
        const reading = normalizeImageReading(parsed);

        return {
          status: "success",
          dimensions: validation.normalized,
          ...(reading ? { reading } : {}),
          summary,
          rawUsage: {
            promptTokens: data?.usage?.input_tokens,
            completionTokens: data?.usage?.output_tokens
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
          summary: error instanceof Error ? error.message : "Anthropic 网络连接异常"
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
