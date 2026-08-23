import {
  ELEMENT_BLACKLIST_GROUPS,
  type ElementThresholdOverrides,
  type FilterDecision,
  type FilterReason,
  type VisionAssessment
} from "@sanctuary/domain";

const MAX_AUTOMATIC_THRESHOLD_STEP = 0.04;
const ALLOW_MARGIN = 0.01;
const MIN_THRESHOLD = 0.05;
const MAX_THRESHOLD = 0.95;
const MAX_FEEDBACK_CHANGES = 3;
const MAX_DISLIKE_CHANGES = 5;
const MAX_DISLIKE_CANDIDATES = 16;
const MAX_PERSONAL_TAG_PREFERENCES = 512;
const MIN_CANDIDATE_CONFIDENCE = 0.12;
const PERSONAL_MIN_LABEL_CONFIDENCE = 0.15;
const PERSONAL_MIN_EVIDENCE = 2;
const PERSONAL_BLOCK_SCORE = 0.52;
const PERSONAL_MAX_REASONS = 3;
const DISLIKE_WEIGHT_STEP = 0.18;

const GENERIC_TAGS = new Set([
  "1boy", "1girl", "2boys", "2girls", "3boys", "3girls", "4boys", "4girls",
  "solo", "duo", "multiple_boys", "multiple_girls", "group", "looking_at_viewer",
  "simple_background", "white_background", "black_background", "grey_background",
  "blue_background", "red_background", "pink_background", "outdoors", "indoors",
  "upper_body", "full_body", "portrait", "close-up", "from_front", "from_side",
  "standing", "sitting", "lying", "smile", "closed_mouth", "open_mouth"
]);
const GENERIC_TAG_PATTERN = /^(?:long|short|medium|very_long)_(?:hair|sleeves)$|^(?:black|brown|blonde|blue|green|grey|orange|pink|purple|red|silver|white)_(?:hair|eyes)$|^(?:hair|eye)_ornament$/;
const BUILT_IN_FILTER_TAGS = new Set(
  ELEMENT_BLACKLIST_GROUPS.flatMap((group) => group.tags)
);

export interface AdaptiveThresholdChange {
  label: string;
  confidence: number;
  oldThreshold: number;
  newThreshold: number;
  hadOverride: boolean;
}

export interface PersonalTagPreference {
  label: string;
  weight: number;
  evidenceCount: number;
  enabled: boolean;
  explicit: boolean;
  updatedAt: string;
}

export type PersonalTagPreferenceProfile = Record<string, PersonalTagPreference>;

export interface PersonalTagPreferenceChange {
  label: string;
  confidence: number;
  oldPreference: PersonalTagPreference | null;
  newPreference: PersonalTagPreference | null;
}

interface AdaptivePreferenceFeedbackBase {
  id: string;
  pageKey: string;
  normalizedUrl: string;
  engine: string;
  engineVersion: string;
  createdAt: string;
}

export interface FalsePositivePreferenceFeedback extends AdaptivePreferenceFeedbackBase {
  kind: "false-positive";
  changes: AdaptiveThresholdChange[];
  personalChanges: PersonalTagPreferenceChange[];
  hadAllowException: boolean;
  hadDislikeException: boolean;
}

export interface DislikePreferenceFeedback extends AdaptivePreferenceFeedbackBase {
  kind: "dislike";
  selectedTags: Array<{ label: string; confidence: number }>;
  personalChanges: PersonalTagPreferenceChange[];
  hadAllowException: boolean;
}

export type AdaptivePreferenceFeedback =
  | FalsePositivePreferenceFeedback
  | DislikePreferenceFeedback;

export interface DislikeTagCandidate {
  label: string;
  confidence: number;
  recommended: boolean;
  existingWeight: number;
  evidenceCount: number;
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

export function normalizePersonalTagPreferences(value: unknown): PersonalTagPreferenceProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const profile: PersonalTagPreferenceProfile = {};
  let accepted = 0;
  for (const [label, entry] of Object.entries(value)) {
    if (accepted >= MAX_PERSONAL_TAG_PREFERENCES) break;
    if (!isSafeLabel(label) || !isPersonalTagPreference(entry) || entry.label !== label) continue;
    profile[label] = normalizePersonalTagPreference(entry);
    accepted += 1;
  }
  return profile;
}

export function normalizeFeedbackHistory(value: unknown): AdaptivePreferenceFeedback[] {
  if (!Array.isArray(value)) return [];
  const history: AdaptivePreferenceFeedback[] = [];
  for (const entry of value.slice(-500)) {
    const normalized = normalizeAdaptivePreferenceFeedback(entry);
    if (normalized) history.push(normalized);
  }
  return history;
}

export function selectDislikeTagCandidates(input: {
  assessment: VisionAssessment;
  preferences: PersonalTagPreferenceProfile;
}): DislikeTagCandidate[] {
  if (input.assessment.status !== "complete") return [];
  return Object.entries(input.assessment.labels)
    .filter(([label, confidence]) =>
      isSafeLabel(label) && isConfidence(confidence) && confidence >= MIN_CANDIDATE_CONFIDENCE
    )
    .map(([label, confidence]) => {
      const preference = input.preferences[label];
      const generic = isGenericTag(label);
      const recommended = !generic && (
        BUILT_IN_FILTER_TAGS.has(label) ||
        Boolean(preference) ||
        confidence >= 0.35
      );
      return {
        label,
        confidence,
        recommended,
        existingWeight: preference?.weight ?? 0,
        evidenceCount: preference?.evidenceCount ?? 0,
        rank: confidence +
          (preference ? 1.5 : 0) +
          (BUILT_IN_FILTER_TAGS.has(label) ? 1 : 0) +
          (generic ? -2 : recommended ? 0.3 : 0)
      };
    })
    .sort((left, right) => right.rank - left.rank || right.confidence - left.confidence)
    .slice(0, MAX_DISLIKE_CANDIDATES)
    .map(({ rank: _rank, ...candidate }) => candidate);
}

export function createFalsePositiveFeedback(input: {
  id: string;
  normalizedUrl: string;
  assessment: VisionAssessment;
  reasons: readonly FilterReason[];
  thresholdOverrides: ElementThresholdOverrides;
  personalPreferences?: PersonalTagPreferenceProfile;
  hadAllowException?: boolean;
  hadDislikeException?: boolean;
  now?: Date;
}): FalsePositivePreferenceFeedback | null {
  if (input.assessment.status !== "complete") return null;
  const pageKey = pixivArtworkPageKey(input.normalizedUrl);
  if (!pageKey) return null;

  const now = (input.now ?? new Date()).toISOString();
  const seen = new Set<string>();
  const changes: AdaptiveThresholdChange[] = [];
  const personalChanges: PersonalTagPreferenceChange[] = [];
  for (const reason of input.reasons) {
    if (seen.has(reason.label)) continue;
    seen.add(reason.label);
    const confidence = input.assessment.labels[reason.label] ?? reason.confidence;
    if (!Number.isFinite(confidence)) continue;

    if (reason.ruleId.startsWith("personal-preference:")) {
      const oldPreference = input.personalPreferences?.[reason.label];
      if (!oldPreference || personalChanges.length >= MAX_FEEDBACK_CHANGES) continue;
      const evidenceCount = Math.max(0, oldPreference.evidenceCount - 1);
      const weight = roundWeight(Math.max(0, oldPreference.weight - Math.max(0.08, oldPreference.weight * 0.25)));
      const newPreference = evidenceCount === 0 && weight === 0
        ? null
        : { ...oldPreference, weight, evidenceCount, updatedAt: now };
      personalChanges.push({ label: reason.label, confidence, oldPreference, newPreference });
      continue;
    }

    if (changes.length >= MAX_FEEDBACK_CHANGES) continue;
    const hadOverride = Object.prototype.hasOwnProperty.call(input.thresholdOverrides, reason.label);
    const oldThreshold = clampThreshold(input.thresholdOverrides[reason.label] ?? reason.threshold);
    const desiredThreshold = roundThresholdUp(confidence + ALLOW_MARGIN);
    const newThreshold = clampThreshold(
      Math.max(oldThreshold, Math.min(desiredThreshold, oldThreshold + MAX_AUTOMATIC_THRESHOLD_STEP))
    );
    if (newThreshold <= oldThreshold) continue;
    changes.push({ label: reason.label, confidence, oldThreshold, newThreshold, hadOverride });
  }

  return {
    id: input.id,
    kind: "false-positive",
    pageKey,
    normalizedUrl: input.normalizedUrl,
    engine: input.assessment.engine,
    engineVersion: input.assessment.engineVersion,
    changes,
    personalChanges,
    hadAllowException: input.hadAllowException ?? false,
    hadDislikeException: input.hadDislikeException ?? false,
    createdAt: now
  };
}

export function createDislikeFeedback(input: {
  id: string;
  normalizedUrl: string;
  assessment: VisionAssessment;
  selectedLabels: readonly string[];
  personalPreferences: PersonalTagPreferenceProfile;
  hadAllowException?: boolean;
  now?: Date;
}): DislikePreferenceFeedback | null {
  if (input.assessment.status !== "complete") return null;
  const pageKey = pixivArtworkPageKey(input.normalizedUrl);
  if (!pageKey) return null;
  const now = (input.now ?? new Date()).toISOString();
  const selectedLabels = [...new Set(input.selectedLabels)]
    .filter((label) => isSafeLabel(label) && Number.isFinite(input.assessment.labels[label]))
    .slice(0, MAX_DISLIKE_CHANGES);
  const selectedTags: Array<{ label: string; confidence: number }> = [];
  const personalChanges: PersonalTagPreferenceChange[] = [];

  for (const label of selectedLabels) {
    const confidence = input.assessment.labels[label];
    if (!isConfidence(confidence) || confidence < MIN_CANDIDATE_CONFIDENCE) continue;
    const oldPreference = input.personalPreferences[label] ?? null;
    const oldWeight = oldPreference?.weight ?? 0;
    const newPreference: PersonalTagPreference = {
      label,
      weight: roundWeight(oldWeight + (1 - oldWeight) * DISLIKE_WEIGHT_STEP),
      evidenceCount: Math.min(10_000, (oldPreference?.evidenceCount ?? 0) + 1),
      enabled: true,
      explicit: true,
      updatedAt: now
    };
    selectedTags.push({ label, confidence });
    personalChanges.push({ label, confidence, oldPreference, newPreference });
  }

  return {
    id: input.id,
    kind: "dislike",
    pageKey,
    normalizedUrl: input.normalizedUrl,
    engine: input.assessment.engine,
    engineVersion: input.assessment.engineVersion,
    selectedTags,
    personalChanges,
    hadAllowException: input.hadAllowException ?? false,
    createdAt: now
  };
}

export function applyFeedbackChanges(
  overrides: ElementThresholdOverrides,
  feedback: FalsePositivePreferenceFeedback
): Record<string, number> {
  const next = { ...overrides };
  for (const change of feedback.changes) next[change.label] = change.newThreshold;
  return next;
}

export function undoFeedbackChanges(
  overrides: ElementThresholdOverrides,
  feedback: FalsePositivePreferenceFeedback
): Record<string, number> {
  const next = { ...overrides };
  for (const change of feedback.changes) {
    if (change.hadOverride) next[change.label] = change.oldThreshold;
    else delete next[change.label];
  }
  return next;
}

export function applyPersonalPreferenceChanges(
  preferences: PersonalTagPreferenceProfile,
  changes: readonly PersonalTagPreferenceChange[]
): PersonalTagPreferenceProfile {
  const next = { ...preferences };
  for (const change of changes) {
    if (change.newPreference) next[change.label] = { ...change.newPreference };
    else delete next[change.label];
  }
  return next;
}

export function undoPersonalPreferenceChanges(
  preferences: PersonalTagPreferenceProfile,
  changes: readonly PersonalTagPreferenceChange[]
): PersonalTagPreferenceProfile {
  const next = { ...preferences };
  for (const change of changes) {
    if (change.oldPreference) next[change.label] = { ...change.oldPreference };
    else delete next[change.label];
  }
  return next;
}

export function decidePersonalPreference(
  assessment: VisionAssessment,
  preferences: PersonalTagPreferenceProfile,
  now = new Date()
): FilterDecision {
  if (assessment.status !== "complete") {
    return { action: "allow", reasons: [], decidedAt: now.toISOString() };
  }
  const contributors = Object.values(preferences)
    .filter((preference) => preference.enabled && preference.evidenceCount >= PERSONAL_MIN_EVIDENCE)
    .map((preference) => {
      const rawConfidence = assessment.labels[preference.label];
      const confidence = isConfidence(rawConfidence) ? rawConfidence : 0;
      return { preference, confidence, contribution: confidence * preference.weight };
    })
    .filter(({ confidence }) => confidence >= PERSONAL_MIN_LABEL_CONFIDENCE)
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, PERSONAL_MAX_REASONS);
  const score = contributors.reduce((sum, entry) => sum + entry.contribution, 0);
  if (score < PERSONAL_BLOCK_SCORE) {
    return { action: "allow", reasons: [], decidedAt: now.toISOString() };
  }
  return {
    action: "hide",
    reasons: contributors.map(({ preference, confidence }) => ({
      ruleId: `personal-preference:${preference.label}`,
      ruleName: `个人偏好：${preference.label}（权重 ${Math.round(preference.weight * 100)}%）`,
      label: preference.label,
      confidence,
      threshold: PERSONAL_MIN_LABEL_CONFIDENCE
    })),
    decidedAt: now.toISOString()
  };
}

export function personalPreferenceFingerprint(
  preferences: PersonalTagPreferenceProfile
): string | null {
  const canonical = Object.values(preferences)
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((preference) => [
      preference.label,
      preference.enabled ? 1 : 0,
      preference.weight,
      preference.evidenceCount
    ] as const);
  if (canonical.length === 0) return null;
  let hash = 0xcbf29ce484222325n;
  for (const character of JSON.stringify(canonical)) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `personal-fnv1a64-${hash.toString(16).padStart(16, "0")}`;
}

function normalizeAdaptivePreferenceFeedback(value: unknown): AdaptivePreferenceFeedback | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isFeedbackBase(candidate)) return null;
  if (candidate.kind === "false-positive") {
    if (!Array.isArray(candidate.changes) || !candidate.changes.every(isAdaptiveThresholdChange)) return null;
    const personalChanges = Array.isArray(candidate.personalChanges)
      ? candidate.personalChanges.filter(isPersonalTagPreferenceChange)
      : [];
    return {
      id: candidate.id as string,
      kind: "false-positive",
      pageKey: candidate.pageKey as string,
      normalizedUrl: candidate.normalizedUrl as string,
      engine: candidate.engine as string,
      engineVersion: candidate.engineVersion as string,
      changes: candidate.changes,
      personalChanges,
      hadAllowException: candidate.hadAllowException === true,
      hadDislikeException: candidate.hadDislikeException === true,
      createdAt: candidate.createdAt as string
    };
  }
  if (candidate.kind === "dislike") {
    if (!Array.isArray(candidate.selectedTags) || !candidate.selectedTags.every(isSelectedTag)) return null;
    if (!Array.isArray(candidate.personalChanges) || !candidate.personalChanges.every(isPersonalTagPreferenceChange)) return null;
    return {
      id: candidate.id as string,
      kind: "dislike",
      pageKey: candidate.pageKey as string,
      normalizedUrl: candidate.normalizedUrl as string,
      engine: candidate.engine as string,
      engineVersion: candidate.engineVersion as string,
      selectedTags: candidate.selectedTags,
      personalChanges: candidate.personalChanges,
      hadAllowException: candidate.hadAllowException === true,
      createdAt: candidate.createdAt as string
    };
  }
  return null;
}

function isFeedbackBase(value: Record<string, unknown>): boolean {
  return Boolean(
    typeof value.id === "string" && value.id.length > 0 && value.id.length <= 100 &&
    typeof value.pageKey === "string" && /^\d+_p\d+$/.test(value.pageKey) &&
    typeof value.normalizedUrl === "string" &&
    typeof value.engine === "string" &&
    typeof value.engineVersion === "string" &&
    typeof value.createdAt === "string"
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

function isPersonalTagPreference(value: unknown): value is PersonalTagPreference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersonalTagPreference>;
  return Boolean(
    typeof candidate.label === "string" && isSafeLabel(candidate.label) &&
    typeof candidate.weight === "number" && Number.isFinite(candidate.weight) &&
    typeof candidate.evidenceCount === "number" && Number.isInteger(candidate.evidenceCount) &&
    typeof candidate.enabled === "boolean" &&
    typeof candidate.explicit === "boolean" &&
    typeof candidate.updatedAt === "string"
  );
}

function normalizePersonalTagPreference(value: PersonalTagPreference): PersonalTagPreference {
  return {
    ...value,
    weight: roundWeight(value.weight),
    evidenceCount: Math.min(10_000, Math.max(0, value.evidenceCount))
  };
}

function isPersonalTagPreferenceChange(value: unknown): value is PersonalTagPreferenceChange {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersonalTagPreferenceChange>;
  return Boolean(
    typeof candidate.label === "string" && isSafeLabel(candidate.label) &&
    typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence) &&
    (candidate.oldPreference === null || isPersonalTagPreference(candidate.oldPreference)) &&
    (candidate.newPreference === null || isPersonalTagPreference(candidate.newPreference))
  );
}

function isSelectedTag(value: unknown): value is { label: string; confidence: number } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { label?: unknown; confidence?: unknown };
  return typeof candidate.label === "string" && isSafeLabel(candidate.label) &&
    typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence);
}

function isGenericTag(label: string): boolean {
  return GENERIC_TAGS.has(label) || GENERIC_TAG_PATTERN.test(label);
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
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

function roundWeight(value: number): number {
  return Math.min(MAX_THRESHOLD, Math.max(0, Math.round(value * 1_000) / 1_000));
}
