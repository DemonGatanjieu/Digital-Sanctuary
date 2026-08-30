import { describe, expect, it } from "vitest";
import { ADAPTIVE_ART_SUITE_V1, FINE_ART_SUITE_V1 } from "@sanctuary/domain";
import {
  createEvaluationJsonSchema,
  createEvaluationPrompt,
  normalizeImageReading,
  parseModelJsonObject,
  repairAdaptiveModelDimensions,
  validateEvaluationDimensions
} from "./evaluation-contract.js";

describe("adaptive evaluation contract", () => {
  it("asks the model to choose exactly six image-specific axes", () => {
    const prompt = createEvaluationPrompt(ADAPTIVE_ART_SUITE_V1);
    expect(prompt).toContain("恰好六个");
    expect(prompt).toContain("不要全部填 0");
    expect(prompt).toContain("axis_1、axis_2、axis_3、axis_4、axis_5、axis_6");
    expect(prompt).toContain("95 以上只留给极少见");
    expect(prompt).toContain("不要一味赞美");
    expect(prompt).toContain("两到三句中文");
    expect(prompt).toContain("observation");
    expect(prompt).toContain("可见的主体、位置、颜色、动作与关系");
    expect(prompt).toContain("无法确认");
  });

  it("keeps observable facts separate from interpretation and bounded uncertainty", () => {
    expect(normalizeImageReading({
      observation: " 角色位于画面中央，手中拿着一束花。 ",
      visual_focus: ["角色面部", "手中花束", "角色面部"],
      interpretation: "冷色调可能营造安静的氛围。",
      uncertainty: ["无法确认角色身份", 12, "无法确认作品出处"]
    })).toEqual({
      observation: "角色位于画面中央，手中拿着一束花。",
      interpretation: "冷色调可能营造安静的氛围。",
      visualFocus: ["角色面部", "手中花束"],
      uncertainties: ["无法确认角色身份", "无法确认作品出处"]
    });
    expect(normalizeImageReading({ interpretation: "缺少观察" })).toBeUndefined();
  });

  it("provides llama.cpp with a strict six-dimension JSON schema", () => {
    const schema = createEvaluationJsonSchema(ADAPTIVE_ART_SUITE_V1) as {
      required: string[];
      properties: { dimensions: { minItems: number; maxItems: number; items: { required: string[] } } };
    };
    expect(schema.required).toEqual([
      "observation", "visual_focus", "interpretation", "uncertainty", "dimensions", "summary"
    ]);
    expect(schema.properties.dimensions).toMatchObject({ minItems: 6, maxItems: 6 });
    expect(schema.properties.dimensions.items.required).toEqual(["key", "label", "score", "reason"]);
  });

  it("recovers common local-model JSON wrappers without weakening field validation", () => {
    expect(parseModelJsonObject('模型说明：```json\n{"dimensions":[],}\n```谢谢')).toEqual({ dimensions: [] });
    expect(parseModelJsonObject(JSON.stringify({ result: JSON.stringify({ observation: "可见人物" }) })))
      .toEqual({ observation: "可见人物" });
    expect(parseModelJsonObject([{ key: "axis_1", score: 70 }]))
      .toEqual({ dimensions: [{ key: "axis_1", score: 70 }] });
    expect(parseModelJsonObject("这是一段普通拒答")).toBeNull();
  });

  it("repairs Chinese keys and an explanation alias from a small local model", () => {
    const dimensions = ["构图", "角色表演", "线条节奏", "材质塑造", "色彩关系", "光影"].map((label, index) => ({
      key: label,
      label,
      score: 70 + index,
      explanation: `${label}具有明确的画面证据`
    }));

    const result = validateEvaluationDimensions(dimensions, ADAPTIVE_ART_SUITE_V1);
    expect(result.valid).toBe(true);
    expect(result.normalized).toHaveLength(6);
    expect(result.normalized?.map((item) => item.key)).toEqual([
      "adaptive_axis_1",
      "adaptive_axis_2",
      "adaptive_axis_3",
      "adaptive_axis_4",
      "adaptive_axis_5",
      "adaptive_axis_6"
    ]);
    expect(result.normalized?.[0]).toMatchObject({ label: "构图", explanation: "构图具有明确的画面证据" });
  });

  it("keeps the highest-scoring six when the model returns one surplus axis", () => {
    const dimensions = ["构图", "角色表演", "线条节奏", "材质塑造", "色彩关系", "光影", "氛围"].map((label, index) => ({
      key: label,
      label,
      score: index === 2 ? 12 : 80 - index,
      reason: `${label}具有明确的画面证据`
    }));

    const repaired = repairAdaptiveModelDimensions(dimensions) as Array<Record<string, unknown>>;
    expect(repaired).toHaveLength(6);
    expect(repaired.map((item) => item.label)).not.toContain("线条节奏");
    expect(validateEvaluationDimensions(dimensions, ADAPTIVE_ART_SUITE_V1).valid).toBe(true);
  });

  it("still rejects incomplete evidence instead of inventing missing axes", () => {
    const dimensions = ["构图", "角色表演", "线条节奏", "材质塑造", "色彩关系"].map((label, index) => ({
      key: label,
      label,
      score: 70 + index,
      reason: `${label}具有明确的画面证据`
    }));
    expect(validateEvaluationDimensions(dimensions, ADAPTIVE_ART_SUITE_V1).valid).toBe(false);
  });

  it("rejects a wildly oversized response instead of treating it as a harmless surplus", () => {
    const dimensions = Array.from({ length: 11 }, (_, index) => ({
      key: `axis_${index + 1}`,
      label: `观察维度${index + 1}`,
      score: 70 + index,
      reason: `第${index + 1}项具有明确的画面证据`
    }));
    expect(validateEvaluationDimensions(dimensions, ADAPTIVE_ART_SUITE_V1).valid).toBe(false);
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
