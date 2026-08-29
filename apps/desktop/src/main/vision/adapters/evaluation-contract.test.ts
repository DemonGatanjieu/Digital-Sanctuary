import { describe, expect, it } from "vitest";
import { ADAPTIVE_ART_SUITE_V1, FINE_ART_SUITE_V1 } from "@sanctuary/domain";
import { createEvaluationPrompt, validateEvaluationDimensions } from "./evaluation-contract.js";

describe("adaptive evaluation contract", () => {
  it("asks the model to choose exactly six image-specific axes", () => {
    const prompt = createEvaluationPrompt(ADAPTIVE_ART_SUITE_V1);
    expect(prompt).toContain("恰好六个");
    expect(prompt).toContain("不得全部填 0");
  });

  it("accepts six dynamic axes but rejects five", () => {
    const dimensions = Array.from({ length: 6 }, (_, index) => ({
      key: `visual_axis_${index}`,
      label: `画面维度${index + 1}`,
      score: 70 + index,
      reason: "可见证据"
    }));
    expect(validateEvaluationDimensions(dimensions, ADAPTIVE_ART_SUITE_V1).valid).toBe(true);
    expect(validateEvaluationDimensions(dimensions.slice(0, 5), ADAPTIVE_ART_SUITE_V1).valid).toBe(false);
    expect(validateEvaluationDimensions(dimensions.map((item) => ({ ...item, score: 0 })), ADAPTIVE_ART_SUITE_V1).valid).toBe(false);
    expect(validateEvaluationDimensions(dimensions.map((item, index) => index === 0
      ? { ...item, label: "short Chinese label" }
      : item), ADAPTIVE_ART_SUITE_V1).valid).toBe(false);
  });

  it("keeps the standard suite fixed and comparable", () => {
    const dimensions = FINE_ART_SUITE_V1.dimensions.map((dimension) => ({ key: dimension.key, score: 80 }));
    expect(validateEvaluationDimensions(dimensions, FINE_ART_SUITE_V1).normalized?.map((item) => item.key))
      .toEqual(FINE_ART_SUITE_V1.dimensions.map((item) => item.key));
  });
});
