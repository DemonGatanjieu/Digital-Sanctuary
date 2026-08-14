import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FINE_ART_SUITE_V1 } from "@sanctuary/domain";
import { generateStandardTestFixtures } from "../../../../../../services/vision/src/fixtures.js";
import { GeminiVisionAdapter } from "./gemini-adapter.js";
import type { PreparedVisionImage } from "../vision-image-preprocessor.js";

describe("GeminiVisionAdapter contract tests", () => {
  const adapter = new GeminiVisionAdapter();
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

  it("handles successful structured response from Gemini 1.5", async () => {
    const mockResponseBody = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  dimensions: [
                    { key: "composition", score: 80, explanation: "透视合理" },
                    { key: "color_harmony", score: 88, explanation: "色调统一" },
                    { key: "lighting", score: 75, explanation: "光影分明" },
                    { key: "visual_focus", score: 85, explanation: "焦点清晰" },
                    { key: "atmosphere", score: 90, explanation: "氛围浓厚" },
                    { key: "detail_control", score: 70, explanation: "细节适中" }
                  ],
                  summary: "Gemini 评估：意境与色彩俱佳。"
                })
              }
            ]
          }
        }
      ],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 150 }
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponseBody
    });

    const result = await adapter.analyze({
      image: sampleImage,
      suite: FINE_ART_SUITE_V1,
      model: "gemini-1.5-flash",
      apiKey: "AIzaSyTestMockKey"
    });

    expect(result.status).toBe("success");
    expect(result.dimensions).toHaveLength(6);
    expect(result.summary).toBe("Gemini 评估：意境与色彩俱佳。");
  });

  it("handles Gemini safety blockReason by returning content_blocked", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        promptFeedback: { blockReason: "SAFETY" }
      })
    });

    const result = await adapter.analyze({
      image: sampleImage,
      suite: FINE_ART_SUITE_V1,
      model: "gemini-1.5-flash",
      apiKey: "AIzaSyTestMockKey"
    });

    expect(result.status).toBe("content_blocked");
    expect(result.reasonCode).toBe("safety_safety");
  });
});
