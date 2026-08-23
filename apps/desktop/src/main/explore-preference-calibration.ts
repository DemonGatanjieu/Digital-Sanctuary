import type {
  ElementThresholdOverrides,
  FilterReason,
  VisionAssessment
} from "@sanctuary/domain";

const MAX_AUTOMATIC_THRESHOLD_STEP = 0.04;
const ALLOW_MARGIN = 0.01;
const MIN_THRESHOLD = 0.05;
const MAX_THRESHOLD = 0.95;
const MAX_FEEDBACK_CHANGES = 3;

export interface AdaptiveThresholdChange {
  label: string;
  confidence: number;
  oldThreshold: number;
  newThreshold: number;
  hadOverride: boolean;
}

export interface AdaptivePreferenceFeedback {
  id: string;
  kind: "false-positive";
  pageKey: string;
  normalizedUrl: string;
  engine: string;
  engineVersion: string;
  changes: AdaptiveThresholdChange[];
  createdAt: string;
}

export function pixivArtworkPageKey(url: string): string | null {
  const match = url.match(/\/(\d+_p\d+)(?:_[^/]*)?(?:\.[a-zA-Z0-9]+)?(?:[?#].*)?$/);
  return match?.[1] ?? null;
}

export function normalizeThresholdOverrides(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [label, threshold] of Object.entries(value)) {
    if (!isSafeLabel(label) || typeof threshold !== "number" || !Number.isFinite(threshold)) continue;
    result[label] = clampThreshold(threshold);
  }
  return result;
}

export function normalizePageExceptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string =>
    typeof entry === "string" && /^\d+_p\d+$/.test(entry)
  ))].slice(-2_000);
}

export function normalizeFeedbackHistory(value: unknown): AdaptivePreferenceFeedback[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isAdaptivePreferenceFeedback).slice(-500);
}

export function createFalsePositiveFeedback(input: {
  id: string;
  normalizedUrl: string;
  assessment: VisionAssessment;
  reasons: readonly FilterReason[];
  thresholdOverrides: ElementThresholdOverrides;
  now?: Date;
}): AdaptivePreferenceFeedback | null {
  if (input.assessment.status !== "complete") return null;
  const pageKey = pixivArtworkPageKey(input.normalizedUrl);
  if (!pageKey) return null;

  const seen = new Set<string>();
  const changes: AdaptiveThresholdChange[] = [];
  for (const reason of input.reasons) {
    if (changes.length >= MAX_FEEDBACK_CHANGES || seen.has(reason.label)) continue;
    seen.add(reason.label);
    const confidence = input.assessment.labels[reason.label] ?? reason.confidence;
    if (!Number.isFinite(confidence)) continue;
    const hadOverride = Object.prototype.hasOwnProperty.call(input.thresholdOverrides, reason.label);
    const oldThreshold = clampThreshold(input.thresholdOverrides[reason.label] ?? reason.threshold);
    const desiredThreshold = roundThresholdUp(confidence + ALLOW_MARGIN);
    const newThreshold = clampThreshold(
      Math.max(oldThreshold, Math.min(desiredThreshold, oldThreshold + MAX_AUTOMATIC_THRESHOLD_STEP))
    );
    if (newThreshold <= oldThreshold) continue;
    changes.push({
      label: reason.label,
      confidence,
      oldThreshold,
      newThreshold,
      hadOverride
    });
  }

  return {
    id: input.id,
    kind: "false-positive",
    pageKey,
    normalizedUrl: input.normalizedUrl,
    engine: input.assessment.engine,
    engineVersion: input.assessment.engineVersion,
    changes,
    createdAt: (input.now ?? new Date()).toISOString()
  };
}

export function applyFeedbackChanges(
  overrides: ElementThresholdOverrides,
  feedback: AdaptivePreferenceFeedback
): Record<string, number> {
  const next = { ...overrides };
  for (const change of feedback.changes) next[change.label] = change.newThreshold;
  return next;
}

export function undoFeedbackChanges(
  overrides: ElementThresholdOverrides,
  feedback: AdaptivePreferenceFeedback
): Record<string, number> {
  const next = { ...overrides };
  for (const change of feedback.changes) {
    if (change.hadOverride) next[change.label] = change.oldThreshold;
    else delete next[change.label];
  }
  return next;
}

function isAdaptivePreferenceFeedback(value: unknown): value is AdaptivePreferenceFeedback {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AdaptivePreferenceFeedback>;
  return Boolean(
    typeof candidate.id === "string" && candidate.id.length > 0 && candidate.id.length <= 100 &&
    candidate.kind === "false-positive" &&
    typeof candidate.pageKey === "string" && /^\d+_p\d+$/.test(candidate.pageKey) &&
    typeof candidate.normalizedUrl === "string" &&
    typeof candidate.engine === "string" &&
    typeof candidate.engineVersion === "string" &&
    typeof candidate.createdAt === "string" &&
    Array.isArray(candidate.changes) && candidate.changes.every(isAdaptiveThresholdChange)
  );
}

function isAdaptiveThresholdChange(value: unknown): value is AdaptiveThresholdChange {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AdaptiveThresholdChange>;
  return Boolean(
    typeof candidate.label === "string" && isSafeLabel(candidate.label) &&
    typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence) &&
    typeof candidate.oldThreshold === "number" && Number.isFinite(candidate.oldThreshold) &&
    typeof candidate.newThreshold === "number" && Number.isFinite(candidate.newThreshold) &&
    typeof candidate.hadOverride === "boolean"
  );
}

function isSafeLabel(label: string): boolean {
  return label.length > 0 && label.length <= 120 && !/[\u0000-\u001f]/.test(label);
}

function clampThreshold(value: number): number {
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, Math.round(value * 100) / 100));
}

function roundThresholdUp(value: number): number {
  return Math.ceil(value * 100) / 100;
}
