import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_ART_SUITE_V1,
  CHARACTER_PRESENCE_SUITE_V1,
  FINE_ART_SUITE_V1,
  TECHNICAL_VISUAL_SUITE_V1,
  getVisionSuite,
  listVisionSuites,
  validateAdaptiveHighlights,
  validateDimensionScores,
  validateExternalVisionPublicConfig
} from "./vision-suites.js";

describe("Vision Suite Registry", () => {
  it("registers technical and external fixed suites with version 1", () => {
    const suites = listVisionSuites();
    expect(suites).toHaveLength(4);

    const tech = getVisionSuite("technical_visual_v1", 1);
    expect(tech).not.toBeNull();
    expect(tech?.kind).toBe("local_technical_profile");
    expect(tech?.dimensions.map((d) => d.key)).toEqual([
      "colorfulness",
      "tonal_range",
      "luminance_balance",
      "edge_density",
      "sharpness_proxy",
      "spatial_balance"
    ]);

    const fineArt = getVisionSuite("fine_art_v1", 1);
    expect(fineArt?.kind).toBe("external_fixed_suite");
    expect(fineArt?.dimensions).toHaveLength(6);

    const char = getVisionSuite("character_presence_v1", 1);
    expect(char?.kind).toBe("external_fixed_suite");
    expect(char?.dimensions).toHaveLength(6);

    const adaptive = getVisionSuite(ADAPTIVE_ART_SUITE_V1.id, 1);
    expect(adaptive?.kind).toBe("external_adaptive_highlights");
    expect(adaptive?.dimensions).toHaveLength(0);
  });

  it("returns null for unknown suite or invalid version", () => {
    expect(getVisionSuite("non_existent_suite", 1)).toBeNull();
    expect(getVisionSuite("technical_visual_v1", 99)).toBeNull();
  });
});

describe("validateDimensionScores", () => {
  const validTechDimensions = [
    { key: "colorfulness", score: 72.5, explanation: "High saturation diversity" },
    { key: "tonal_range", score: 85.0 },
    { key: "luminance_balance", score: 50.2 },
    { key: "edge_density", score: 64.1 },
    { key: "sharpness_proxy", score: 78.9 },
    { key: "spatial_balance", score: 60.0 }
  ];

  it("validates and normalizes valid dimension scores in suite order", () => {
    // Pass in reversed order to check deterministic sorting
    const reversed = [...validTechDimensions].reverse();
    const result = validateDimensionScores(reversed, TECHNICAL_VISUAL_SUITE_V1);

    expect(result.valid).toBe(true);
    expect(result.normalized).toHaveLength(6);
    expect(result.normalized?.[0]?.key).toBe("colorfulness");
    expect(result.normalized?.[0]?.score).toBe(72.5);
    expect(result.normalized?.[0]?.label).toBe("色彩丰富度");
  });

  it("rejects missing required dimension keys", () => {
    const missing = validTechDimensions.slice(0, 4);
    const result = validateDimensionScores(missing, TECHNICAL_VISUAL_SUITE_V1);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required dimension key: sharpness_proxy");
    expect(result.errors).toContain("Missing required dimension key: spatial_balance");
  });

  it("rejects out of bounds and non-finite numbers (0..100)", () => {
    const invalid = validTechDimensions.map((d) =>
      d.key === "colorfulness" ? { ...d, score: 105.0 } : d
    );
    const result = validateDimensionScores(invalid, TECHNICAL_VISUAL_SUITE_V1);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("between 0 and 100"))).toBe(true);

    const nanScore = validTechDimensions.map((d) =>
      d.key === "colorfulness" ? { ...d, score: Number.NaN } : d
    );
    expect(validateDimensionScores(nanScore, TECHNICAL_VISUAL_SUITE_V1).valid).toBe(false);
  });

  it("ignores extra unknown keys and rejects duplicates", () => {
    const withExtra = [
      ...validTechDimensions,
      { key: "unknown_metric", score: 50 }
    ];
    const result = validateDimensionScores(withExtra, TECHNICAL_VISUAL_SUITE_V1);
    expect(result.valid).toBe(true);
    expect(result.normalized).toHaveLength(6);

    const withDuplicate = [
      ...validTechDimensions,
      { key: "colorfulness", score: 60 }
    ];
    const dupResult = validateDimensionScores(withDuplicate, TECHNICAL_VISUAL_SUITE_V1);
    expect(dupResult.valid).toBe(false);
    expect(dupResult.errors?.some((e) => e.includes("Duplicate dimension key"))).toBe(true);
  });
});

describe("validateAdaptiveHighlights", () => {
  it("validates valid adaptive highlight entries", () => {
    const raw = [
      { key: "dramatic_lighting", label: "剧场光效", score: 92.4, reason: "强烈的明暗对比" },
      { key: "costume_flow", label: "裙摆动态", score: 88.0 }
    ];
    const result = validateAdaptiveHighlights(raw);
    expect(result.valid).toBe(true);
    expect(result.normalized).toHaveLength(2);
    expect(result.normalized?.[0]?.key).toBe("dramatic_lighting");
  });

  it("rejects invalid keys and empty lists", () => {
    expect(validateAdaptiveHighlights([]).valid).toBe(false);
    expect(validateAdaptiveHighlights([{ key: "INVALID-KEY!", label: "Test", score: 50 }]).valid).toBe(false);
    expect(validateAdaptiveHighlights([{ key: "score_over", label: "Test", score: 150 }]).valid).toBe(false);
  });

  it("can require exactly six model-selected dimensions", () => {
    const six = Array.from({ length: 6 }, (_, index) => ({
      key: `dimension_${index}`,
      label: `维度 ${index}`,
      score: 60 + index,
      reason: "画面中存在具体可见证据"
    }));
    expect(validateAdaptiveHighlights(six, 6).valid).toBe(true);
    expect(validateAdaptiveHighlights(six.slice(0, 5), 6).valid).toBe(false);
  });
});

describe("validateExternalVisionPublicConfig", () => {
  it("validates and normalizes valid public config", () => {
    const raw = {
      id: "openai_main",
      provider: "openai",
      model: "gpt-4o",
      endpoint: "https://api.openai.com/v1",
      hasApiKey: true,
      keyHint: "sk-...1234",
      enabled: true,
      maxConcurrency: 2,
      maxLongEdge: 1568
    };
    const result = validateExternalVisionPublicConfig(raw);
    expect(result.valid).toBe(true);
    expect(result.normalized?.model).toBe("gpt-4o");
    expect(result.normalized?.hasApiKey).toBe(true);
  });

  it("rejects invalid providers or credential-leaking endpoints", () => {
    expect(
      validateExternalVisionPublicConfig({
        provider: "unknown_cloud",
        model: "m1"
      }).valid
    ).toBe(false);

    expect(
      validateExternalVisionPublicConfig({
        provider: "openai",
        model: "m1",
        endpoint: "https://user:pass@evil.com/v1"
      }).valid
    ).toBe(false);
  });
});
