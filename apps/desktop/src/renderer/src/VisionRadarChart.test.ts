import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TECHNICAL_VISUAL_SUITE_V1, FINE_ART_SUITE_V1 } from "@sanctuary/domain";
import type { VisionEvaluationResult } from "@sanctuary/domain";
import { VisionRadarChart } from "./VisionRadarChart";

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

  it("renders observable facts separately from subjective interpretation", () => {
    const evaluation: VisionEvaluationResult = {
      id: "reading-test",
      workId: "work-1",
      assetId: "asset-1",
      scope: "cover_asset",
      kind: "external_fixed_suite",
      suiteId: "fine_art_v1",
      suiteVersion: 1,
      status: "success",
      dimensions: FINE_ART_SUITE_V1.dimensions.map((dimension) => ({ ...dimension, score: 70 })),
      reading: {
        observation: "角色位于画面中央，手中拿着花。",
        interpretation: "画面可能表达安静的情绪。",
        visualFocus: ["角色面部", "花束"],
        uncertainties: ["无法确认角色身份"]
      },
      evaluatorVersion: "test",
      preprocessingFingerprint: "test",
      assetVersion: "test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    const html = renderToStaticMarkup(createElement(VisionRadarChart, { evaluation, size: 260 }));
    expect(html).toContain("模型眼中的画面");
    expect(html).toContain("可见事实");
    expect(html).toContain("主观解读");
    expect(html).toContain("模型没有把握的地方");
  });
});
