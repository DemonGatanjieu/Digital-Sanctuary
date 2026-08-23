import { describe, expect, it } from "vitest";
import type { FilterReason, VisionAssessment } from "@sanctuary/domain";
import {
  applyFeedbackChanges,
  createFalsePositiveFeedback,
  normalizeFeedbackHistory,
  normalizePageExceptions,
  normalizeThresholdOverrides,
  pixivArtworkPageKey,
  undoFeedbackChanges
} from "./explore-preference-calibration.js";

const assessment: VisionAssessment = {
  status: "complete",
  engine: "wd-swinv2-tagger-v3",
  engineVersion: "v3/test",
  labels: { blood: 0.91, guro: 0.72 },
  elapsedMs: 12
};

const reasons: FilterReason[] = [
  { ruleId: "blood", ruleName: "血液", label: "blood", confidence: 0.91, threshold: 0.5 },
  { ruleId: "guro", ruleName: "猎奇", label: "guro", confidence: 0.72, threshold: 0.7 }
];

describe("explore preference calibration", () => {
  it("uses the exact Pixiv page as the persistent exception key", () => {
    expect(pixivArtworkPageKey("https://i.pximg.net/img-master/a/12345_p2_master1200.jpg"))
      .toBe("12345_p2");
    expect(pixivArtworkPageKey("https://example.com/12345.jpg")).toBeNull();
  });

  it("keeps each automatic adjustment bounded while preserving an exact exception", () => {
    const feedback = createFalsePositiveFeedback({
      id: "feedback-1",
      normalizedUrl: "https://i.pximg.net/img-master/a/12345_p2_master1200.jpg",
      assessment,
      reasons,
      thresholdOverrides: {},
      now: new Date("2026-08-23T00:00:00.000Z")
    });

    expect(feedback?.pageKey).toBe("12345_p2");
    expect(feedback?.changes).toEqual([
      expect.objectContaining({ label: "blood", oldThreshold: 0.5, newThreshold: 0.54 }),
      expect.objectContaining({ label: "guro", oldThreshold: 0.7, newThreshold: 0.73 })
    ]);
  });

  it("can apply and undo per-label overrides without changing sibling labels", () => {
    const feedback = createFalsePositiveFeedback({
      id: "feedback-2",
      normalizedUrl: "https://i.pximg.net/img-master/a/12345_p0_master1200.jpg",
      assessment,
      reasons: reasons.slice(1),
      thresholdOverrides: { safe: 0.8, guro: 0.71 }
    });
    expect(feedback).not.toBeNull();
    const applied = applyFeedbackChanges({ safe: 0.8, guro: 0.71 }, feedback!);
    expect(applied.safe).toBe(0.8);
    expect(applied.guro).toBe(0.73);
    expect(undoFeedbackChanges(applied, feedback!)).toEqual({ safe: 0.8, guro: 0.71 });
  });

  it("sanitizes persisted preference data", () => {
    expect(normalizeThresholdOverrides({ blood: 2, guro: 0.61, bad: "x" }))
      .toEqual({ blood: 0.95, guro: 0.61 });
    expect(normalizePageExceptions(["123_p0", "123_p0", "bad"])).toEqual(["123_p0"]);
    expect(normalizeFeedbackHistory([{ nope: true }])).toEqual([]);
  });
});
