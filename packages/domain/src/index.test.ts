import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELEMENT_FILTER_SETTINGS,
  DEFAULT_FILTER_RULES,
  buildElementFilterRules,
  decideFilter,
  type VisionAssessment
} from "./index.js";

const assessment = (labels: Record<string, number>): VisionAssessment => ({
  status: "complete",
  engine: "test",
  engineVersion: "1",
  labels,
  elapsedMs: 1
});

describe("decideFilter", () => {
  it("uses the highest-priority matching rule", () => {
    const result = decideFilter(
      assessment({ guro: 0.9, blood: 0.95 }),
      DEFAULT_FILTER_RULES,
      new Date("2026-01-01T00:00:00.000Z")
    );

    expect(result.action).toBe("hide");
    expect(result.reasons).toHaveLength(2);
  });

  it("allows content when no rule matches", () => {
    expect(
      decideFilter(assessment({ explicit: 0.99, suggestive: 0.99 }), DEFAULT_FILTER_RULES)
        .action
    ).toBe("allow");
  });

  it("fails closed with blur when the engine errors", () => {
    const failed: VisionAssessment = {
      status: "error",
      engine: "test",
      engineVersion: "1",
      labels: {},
      elapsedMs: 2,
      error: "offline"
    };

    expect(decideFilter(failed, DEFAULT_FILTER_RULES).action).toBe("blur");
  });

  it("honors a disabled element group", () => {
    const settings = DEFAULT_ELEMENT_FILTER_SETTINGS.map((setting) =>
      setting.groupId === "guro" ? { ...setting, enabled: false } : setting
    );

    expect(decideFilter(assessment({ guro: 0.99 }), buildElementFilterRules(settings)).action)
      .toBe("allow");
  });

  it("honors a customized group threshold", () => {
    const settings = DEFAULT_ELEMENT_FILTER_SETTINGS.map((setting) =>
      setting.groupId === "blood"
        ? { ...setting, minimumConfidence: 0.8 }
        : setting
    );
    const rules = buildElementFilterRules(settings);

    expect(decideFilter(assessment({ blood: 0.7 }), rules).action).toBe("allow");
    expect(decideFilter(assessment({ blood: 0.9 }), rules).action).toBe("hide");
  });
});
