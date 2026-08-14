import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FINE_ART_SUITE_V1 } from "@sanctuary/domain";
import { generateStandardTestFixtures } from "../../../../../../services/vision/src/fixtures.js";
import { OpenAiVisionAdapter } from "./openai-adapter.js";
import type { PreparedVisionImage } from "../vision-image-preprocessor.js";

describe("OpenAiVisionAdapter contract tests", () => {
  const adapter = new OpenAiVisionAdapter("openai", false);
  const fixtures = generateStandardTestFixtures();
  const sampleImage: PreparedVisionImage = {
    buffer: fixtures.solidColor,
    mimeType: "image/png",
    width: 64,
    height: 64,
    byteLength: fixtures.solidColor.length,
    fingerprint: "test_hash",
    cleanup: () => {}
  };

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("handles successful structured output from OpenAI Vision", async () => {
    const mockResponseBody = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              dimensions: [
                { key: "composition", score: 85, explanation: "三分法结构严谨" },
                { key: "color_harmony", score: 90, explanation: "互补色运用娴熟" },
                { key: "lighting", score: 78, explanation: "高光柔和" },
                { key: "visual_focus", score: 88, explanation: "主体突出" },
                { key: "atmosphere", score: 82, explanation: "宁静诗意" },
                { key: "detail_control", score: 75, explanation: "笔触细腻" }
              ],
              summary: "画面色彩与意境表现力俱佳"
            })
          }
        }
      ],
      usage: { prompt_tokens: 500, completion_tokens: 120 }
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponseBody
    });

    const result = await adapter.analyze({
      image: sampleImage,
      suite: FINE_ART_SUITE_V1,
      model: "gpt-4o",
      apiKey: "sk-mock-valid-key"
    });

    expect(result.status).toBe("success");
    expect(result.dimensions).toHaveLength(6);
    expect(result.summary).toBe("画面色彩与意境表现力俱佳");
    expect(result.dimensions.find((d) => d.key === "composition")?.score).toBe(85);
  });

  it("handles 401 Unauthorized by returning auth_error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Incorrect API key provided"
    });

    const result = await adapter.analyze({
      image: sampleImage,
      suite: FINE_ART_SUITE_V1,
      model: "gpt-4o",
      apiKey: "sk-invalid-key"
    });

    expect(result.status).toBe("auth_error");
    expect(result.reasonCode).toBe("unauthorized");
  });

  it("handles 400 safety filter / moderation trigger by returning content_blocked", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "The request was rejected due to safety content_policy violation"
    });

    const result = await adapter.analyze({
      image: sampleImage,
      suite: FINE_ART_SUITE_V1,
      model: "gpt-4o",
      apiKey: "sk-valid-key"
    });

    expect(result.status).toBe("content_blocked");
    expect(result.reasonCode).toBe("safety_filter_triggered");
  });

  it("handles schema mismatch / invalid JSON gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "THIS IS NOT JSON" } }]
      })
    });

    const result = await adapter.analyze({
      image: sampleImage,
      suite: FINE_ART_SUITE_V1,
      model: "gpt-4o",
      apiKey: "sk-valid-key"
    });

    expect(result.status).toBe("invalid_response");
    expect(result.reasonCode).toBe("json_parse_error");
  });
});
