import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FINE_ART_SUITE_V1 } from "@sanctuary/domain";
import { generateStandardTestFixtures } from "../../../../../../services/vision/src/fixtures.js";
import { AnthropicVisionAdapter } from "./anthropic-adapter.js";
import type { PreparedVisionImage } from "../vision-image-preprocessor.js";

describe("AnthropicVisionAdapter contract tests", () => {
  const adapter = new AnthropicVisionAdapter();
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

  it("handles successful structured output from Claude 3.5 Sonnet", async () => {
    const mockResponseBody = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            dimensions: [
              { key: "composition", score: 86, explanation: "结构严谨" },
              { key: "color_harmony", score: 92, explanation: "色彩优雅" },
              { key: "lighting", score: 84, explanation: "层次分明" },
              { key: "visual_focus", score: 90, explanation: "焦点精准" },
              { key: "atmosphere", score: 88, explanation: "意境深远" },
              { key: "detail_control", score: 80, explanation: "细节到位" }
            ],
            summary: "Claude 解读：具有高度美感与视觉张力。"
          })
        }
      ],
      usage: { input_tokens: 600, output_tokens: 180 }
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponseBody
    });

    const result = await adapter.analyze({
      image: sampleImage,
      suite: FINE_ART_SUITE_V1,
      model: "claude-3-5-sonnet-20241022",
      apiKey: "sk-ant-test-key"
    });

    expect(result.status).toBe("success");
    expect(result.dimensions).toHaveLength(6);
    expect(result.summary).toBe("Claude 解读：具有高度美感与视觉张力。");
  });

  it("handles 401 Unauthorized from Anthropic", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid x-api-key"
    });

    const result = await adapter.analyze({
      image: sampleImage,
      suite: FINE_ART_SUITE_V1,
      model: "claude-3-5-sonnet-20241022",
      apiKey: "sk-invalid"
    });

    expect(result.status).toBe("auth_error");
    expect(result.reasonCode).toBe("unauthorized");
  });
});
