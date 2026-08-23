import { describe, expect, it } from "vitest";
import type { FilterReason, VisionAssessment } from "@sanctuary/domain";
import {
  applyFeedbackChanges,
  applyPersonalPreferenceChanges,
  createDislikeFeedback,
  createFalsePositiveFeedback,
  decidePersonalPreference,
  normalizeFeedbackHistory,
  normalizePageExceptions,
  normalizePersonalTagPreferences,
  normalizeThresholdOverrides,
  personalPreferenceFingerprint,
  pixivArtworkPageKey,
  selectDislikeTagCandidates,
  undoPersonalPreferenceChanges,
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

  it("recommends distinctive labels without preselecting common composition tags", () => {
    const candidates = selectDislikeTagCandidates({
      assessment: {
        ...assessment,
        labels: { "1girl": 0.99, solo: 0.97, blood: 0.63, guro: 0.41 }
      },
      preferences: {}
    });

    expect(candidates.find((candidate) => candidate.label === "blood")?.recommended).toBe(true);
    expect(candidates.find((candidate) => candidate.label === "1girl")?.recommended).toBe(false);
    expect(candidates.find((candidate) => candidate.label === "solo")?.recommended).toBe(false);
  });

  it("learns gradually and requires repeated, combined evidence before hiding", () => {
    const first = createDislikeFeedback({
      id: "dislike-1",
      normalizedUrl: "https://i.pximg.net/img-master/a/12345_p0_master1200.jpg",
      assessment,
      selectedLabels: ["blood", "guro"],
      personalPreferences: {},
      now: new Date("2026-08-24T00:00:00.000Z")
    });
    expect(first).not.toBeNull();
    const once = applyPersonalPreferenceChanges({}, first!.personalChanges);
    expect(once.blood).toMatchObject({ weight: 0.18, evidenceCount: 1 });
    expect(decidePersonalPreference(assessment, once).action).toBe("allow");

    const second = createDislikeFeedback({
      id: "dislike-2",
      normalizedUrl: "https://i.pximg.net/img-master/a/67890_p0_master1200.jpg",
      assessment,
      selectedLabels: ["blood", "guro"],
      personalPreferences: once,
      now: new Date("2026-08-24T01:00:00.000Z")
    });
    const twice = applyPersonalPreferenceChanges(once, second!.personalChanges);
    expect(twice.blood).toMatchObject({ weight: 0.328, evidenceCount: 2 });
    expect(decidePersonalPreference(assessment, twice).action).toBe("hide");
    expect(undoPersonalPreferenceChanges(twice, second!.personalChanges)).toEqual(once);
  });

  it("keeps personal profiles model-safe, deterministic and reversible", () => {
    const profile = normalizePersonalTagPreferences({
      blood: {
        label: "blood",
        weight: 4,
        evidenceCount: 2,
        enabled: true,
        explicit: true,
        updatedAt: "2026-08-24T00:00:00.000Z"
      },
      malformed: { label: "different" }
    });
    expect(profile).toEqual({
      blood: expect.objectContaining({ label: "blood", weight: 0.95, evidenceCount: 2 })
    });
    expect(personalPreferenceFingerprint({})).toBeNull();
    expect(personalPreferenceFingerprint(profile)).toBe(personalPreferenceFingerprint(profile));
  });

  it("turns a personal false positive back down without changing hard thresholds", () => {
    const preferences = normalizePersonalTagPreferences({
      blood: {
        label: "blood",
        weight: 0.52,
        evidenceCount: 4,
        enabled: true,
        explicit: true,
        updatedAt: "2026-08-24T00:00:00.000Z"
      }
    });
    const feedback = createFalsePositiveFeedback({
      id: "personal-false-positive",
      normalizedUrl: "https://i.pximg.net/img-master/a/24680_p0_master1200.jpg",
      assessment,
      reasons: [{
        ruleId: "personal-preference:blood",
        ruleName: "个人偏好：blood",
        label: "blood",
        confidence: 0.91,
        threshold: 0.15
      }],
      thresholdOverrides: { safe: 0.8 },
      personalPreferences: preferences
    });

    expect(feedback?.changes).toEqual([]);
    expect(feedback?.personalChanges[0]?.newPreference).toMatchObject({
      weight: 0.39,
      evidenceCount: 3
    });
    expect(applyFeedbackChanges({ safe: 0.8 }, feedback!)).toEqual({ safe: 0.8 });
    expect(undoPersonalPreferenceChanges(
      applyPersonalPreferenceChanges(preferences, feedback!.personalChanges),
      feedback!.personalChanges
    )).toEqual(preferences);
  });
});
