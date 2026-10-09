import { describe, expect, it } from "vitest";
import type { FilterRule } from "@sanctuary/domain";
import { parseWorkQuery } from "../shared/library-query.js";
import { withElementMatch } from "./element-query.js";

const rule = (label: string, minimumConfidence: number, enabled = true): FilterRule =>
  ({ id: label, name: label, enabled, label, minimumConfidence, action: "blur", priority: 1 });

describe("gallery element conditions", () => {
  it("accepts bounded tag lists from the renderer and never a resolved match", () => {
    const query = parseWorkQuery({
      elements: { include: ["cat_ears", " cat_ears ", "", 3, "a,b", "x".repeat(81)], exclude: ["blood", "cat_ears"], blocked: true },
      elementMatch: { engine: "forged", include: [{ tag: "solo", minimum: 0 }], exclude: [], anyOf: [] }
    });
    expect(query.elements).toEqual({ include: ["cat_ears"], exclude: ["blood"], blocked: true });
    expect(query.elementMatch).toBeUndefined();
    expect(parseWorkQuery({ elements: { include: [] } }).elements).toBeUndefined();
  });

  it("resolves conditions against the active tagger and only enabled explore rules", () => {
    const resolved = withElementMatch(
      { elements: { include: ["cat_ears"], exclude: ["blood"], blocked: true } },
      "wd-swinv2-tagger-v3",
      () => [rule("guro", 0.35), rule("blood", 0.5, false)]
    );
    expect(resolved.elementMatch).toEqual({
      engine: "wd-swinv2-tagger-v3",
      include: [{ tag: "cat_ears", minimum: 0.4 }],
      exclude: [{ tag: "blood", minimum: 0.4 }],
      anyOf: [{ tag: "guro", minimum: 0.35 }]
    });
    expect(withElementMatch({ elementMatch: resolved.elementMatch! }, "x", () => []).elementMatch).toBeUndefined();
  });

  it("finds nothing for blocked elements when no rule is enabled", () => {
    const resolved = withElementMatch({ elements: { blocked: true } }, "wd", () => [rule("guro", 0.35, false)]);
    expect(resolved.elementMatch!.anyOf).toHaveLength(1);
    expect(resolved.elementMatch!.anyOf[0]!.minimum).toBe(1);
  });
});
