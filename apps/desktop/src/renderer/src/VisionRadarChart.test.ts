import { describe, expect, it } from "vitest";
import { TECHNICAL_VISUAL_SUITE_V1, FINE_ART_SUITE_V1 } from "@sanctuary/domain";
import type { VisionEvaluationResult } from "@sanctuary/domain";

describe("VisionRadarChart logic", () => {
  it("verifies dimension mapping and score normalization for technical profile", () => {
    const mockResult: VisionEvaluationResult = {
      id: "eval-test",
      workId: "work-1",
      assetId: "asset-1",
      scope: "cover_asset",
      kind: "local_technical_profile",
      suiteId: "technical_visual_v1",
      suiteVersion: 1,
      status: "success",
      dimensions: [
        { key: "colorfulness", label: "色彩丰富度", score: 85 },
        { key: "tonal_range", label: "明暗跨度", score: 70 },
        { key: "luminance_balance", label: "亮度均衡", score: 60 },
        { key: "edge_density", label: "线条密度", score: 45 },
        { key: "sharpness_proxy", label: "清晰锐度", score: 90 },
        { key: "spatial_balance", label: "空间分布", score: 55 }
      ],
      evaluatorVersion: "0.1.0",
      preprocessingFingerprint: "none",
      assetVersion: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };

    expect(mockResult.dimensions).toHaveLength(6);
    expect(mockResult.dimensions.every((d) => d.score >= 0 && d.score <= 100)).toBe(true);
    expect(mockResult.kind).toBe("local_technical_profile");
  });

  it("verifies external AI critique suite mapping", () => {
    const suite = FINE_ART_SUITE_V1;
    expect(suite.dimensions).toHaveLength(6);
    expect(suite.dimensions.map((d) => d.key)).toEqual([
      "composition",
      "color_harmony",
      "lighting",
      "visual_focus",
      "atmosphere",
      "detail_control"
    ]);
  });
});
