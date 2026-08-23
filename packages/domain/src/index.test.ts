import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELEMENT_FILTER_SETTINGS,
  DEFAULT_FILTER_RULES,
  addTagToCustomGroups,
  buildElementFilterRules,
  decideFilter,
  isCustomElementGroup,
  isAnalysisScope,
  isLibraryPreferences,
  rulesFingerprint,
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

  it("builds a stable fingerprint independent of setting order", () => {
    const reversed = [...DEFAULT_ELEMENT_FILTER_SETTINGS].reverse();
    expect(rulesFingerprint()).toBe(rulesFingerprint(reversed));
    expect(rulesFingerprint(reversed.map((setting) =>
      setting.groupId === "blood" ? { ...setting, minimumConfidence: 0.8 } : setting
    ))).not.toBe(rulesFingerprint());
  });

  it("supports custom labels, aliases, actions, and cache fingerprints", () => {
    const customGroup = {
      id: "custom-watermark",
      name: "水印",
      description: "测试自定义元素",
      tags: ["watermark"],
      aliases: ["sample_watermark"],
      defaultThreshold: 0.45,
      action: "blur" as const
    };
    const rules = buildElementFilterRules([], [customGroup]);

    expect(decideFilter(assessment({ sample_watermark: 0.7 }), rules).action).toBe("blur");
    expect(rulesFingerprint([], [customGroup])).not.toBe(rulesFingerprint([], [{ ...customGroup, action: "hide" }]));
    expect(isCustomElementGroup(customGroup)).toBe(true);
  });

  it("supports per-label preference thresholds without weakening sibling labels", () => {
    const settings = DEFAULT_ELEMENT_FILTER_SETTINGS.map((setting) =>
      setting.groupId === "blood" ? { ...setting, minimumConfidence: 0.5 } : setting
    );
    const rules = buildElementFilterRules(settings, [], { blood: 0.82 });

    expect(decideFilter(assessment({ blood: 0.7 }), rules).action).toBe("allow");
    expect(decideFilter(assessment({ blood_on_clothes: 0.7 }), rules).action).toBe("hide");
    expect(rulesFingerprint(settings, [], { blood: 0.82 }))
      .not.toBe(rulesFingerprint(settings, [], { blood: 0.83 }));
  });

  it("validates persistent library preferences", () => {
    expect(isLibraryPreferences({
      defaultView: "author-work",
      defaultSortBy: "artist",
      defaultSortDirection: "asc",
      gridDensity: "compact",
      downloadDirectory: "E:\\Pictures"
    })).toBe(true);
    expect(isLibraryPreferences({ defaultView: "flat" })).toBe(false);
  });

  it("accepts only bounded explicit analysis scopes", () => {
    expect(isAnalysisScope({ type: "all" })).toBe(true);
    expect(isAnalysisScope({ type: "selected", workIds: ["work-1"] })).toBe(true);
    expect(isAnalysisScope({ type: "artist", artistId: "" })).toBe(false);
    expect(isAnalysisScope({ type: "selected", workIds: [42] })).toBe(false);
  });

  it("adds tags to custom groups correctly", () => {
    const initialGroups: any[] = [];
    const after1 = addTagToCustomGroups(initialGroups, "chibi", { action: "hide", threshold: 0.5 });
    expect(after1).toHaveLength(1);
    expect(after1[0]?.tags).toEqual(["chibi"]);
    expect(after1[0]?.action).toBe("hide");

    // Adding duplicate tag does not duplicate
    const after2 = addTagToCustomGroups(after1, "chibi");
    expect(after2).toHaveLength(1);
    expect(after2[0]?.tags).toEqual(["chibi"]);

    const after2Adjusted = addTagToCustomGroups(after2, "chibi", { action: "blur", threshold: 0.65 });
    expect(after2Adjusted[0]?.action).toBe("blur");
    expect(after2Adjusted[0]?.defaultThreshold).toBe(0.65);

    // Adding another tag appends to existing group with same name
    const after3 = addTagToCustomGroups(after2Adjusted, "ai_generated");
    expect(after3).toHaveLength(1);
    expect(after3[0]?.tags).toEqual(["chibi", "ai_generated"]);

    const after4 = addTagToCustomGroups(after3, "watermark", { action: "blur", threshold: 0.7 });
    expect(after4[0]?.action).toBe("blur");
    expect(after4[0]?.defaultThreshold).toBe(0.7);
  });
});
