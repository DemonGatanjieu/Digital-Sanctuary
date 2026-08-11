export type FilterAction = "allow" | "blur" | "hide";

export interface VisionAssessment {
  status: "complete" | "error";
  engine: string;
  engineVersion: string;
  executionProvider?: string;
  labels: Record<string, number>;
  elapsedMs: number;
  error?: string;
}

export interface FilterRule {
  id: string;
  name: string;
  enabled: boolean;
  label: string;
  minimumConfidence: number;
  action: Exclude<FilterAction, "allow">;
  priority: number;
}

export interface FilterReason {
  ruleId: string;
  ruleName: string;
  label: string;
  confidence: number;
  threshold: number;
}

export interface FilterDecision {
  action: FilterAction;
  reasons: FilterReason[];
  decidedAt: string;
}

export interface ArtworkRecord {
  id: string;
  path: string;
  fileName: string;
  importedAt: string;
  assessment: VisionAssessment | null;
  decision: FilterDecision | null;
  collectionIds: string[];
  source: ArtworkSource | null;
}

export interface ArtworkSource {
  platform: "pixiv";
  workId: string;
  pageIndex: number;
  authorId: string;
  authorName: string;
  title: string;
}

export interface CollectionRecord {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface ElementBlacklistGroup {
  id: string;
  name: string;
  description: string;
  tags: string[];
  defaultThreshold: number;
}

export interface ElementFilterSetting {
  groupId: string;
  enabled: boolean;
  minimumConfidence: number;
}

export const ELEMENT_BLACKLIST_GROUPS: ElementBlacklistGroup[] = [
  {
    id: "guro",
    name: "猎奇与内脏",
    description: "猎奇、内脏、尸体与死亡主题",
    tags: ["guro", "intestines", "corpse", "death"],
    defaultThreshold: 0.35
  },
  {
    id: "blood",
    name: "血腥",
    description: "明显流血、喷溅、血泊以及血迹",
    tags: [
      "blood",
      "blood_splatter",
      "pool_of_blood",
      "blood_stain",
      "blood_on_face",
      "blood_on_clothes",
      "blood_on_hands",
      "blood_on_weapon"
    ],
    defaultThreshold: 0.35
  },
  {
    id: "dismemberment",
    name: "断肢与斩首",
    description: "断头、断肢、缺失肢体及截肢表现",
    tags: [
      "severed_head",
      "severed_limb",
      "decapitation",
      "headless",
      "missing_limb",
      "amputee",
      "double_amputee"
    ],
    defaultThreshold: 0.35
  },
  {
    id: "urination",
    name: "排泄相关（小便）",
    description: "WD Tagger 当前标签表可覆盖的小便相关元素",
    tags: ["peeing", "pee", "peeing_self"],
    defaultThreshold: 0.35
  }
];

export const DEFAULT_ELEMENT_FILTER_SETTINGS: ElementFilterSetting[] =
  ELEMENT_BLACKLIST_GROUPS.map((group) => ({
    groupId: group.id,
    enabled: true,
    minimumConfidence: group.defaultThreshold
  }));

export function buildElementFilterRules(
  settings: readonly ElementFilterSetting[] = DEFAULT_ELEMENT_FILTER_SETTINGS
): FilterRule[] {
  const settingsByGroup = new Map(settings.map((setting) => [setting.groupId, setting]));
  return ELEMENT_BLACKLIST_GROUPS.flatMap((group, groupIndex) => {
    const setting = settingsByGroup.get(group.id);
    const minimumConfidence = normalizeConfidence(
      setting?.minimumConfidence,
      group.defaultThreshold
    );
    return group.tags.map((tag) => ({
      id: `element-${group.id}-${tag}`,
      name: `${group.name}：${tag}`,
      enabled: setting?.enabled ?? true,
      label: tag,
      minimumConfidence,
      action: "hide" as const,
      priority: 1_000 - groupIndex
    }));
  });
}

/**
 * Returns a deterministic fingerprint for the active element rules.
 * This is a cache namespace, not an integrity token.
 */
export function rulesFingerprint(
  settings: readonly ElementFilterSetting[] = DEFAULT_ELEMENT_FILTER_SETTINGS
): string {
  const canonical = buildElementFilterRules(settings)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((rule) => [
      rule.id,
      rule.enabled ? 1 : 0,
      rule.label,
      rule.minimumConfidence,
      rule.action,
      rule.priority
    ] as const);
  const input = JSON.stringify(canonical);
  let hash = 0xcbf29ce484222325n;
  for (const character of input) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64-${hash.toString(16).padStart(16, "0")}`;
}

export const DEFAULT_FILTER_RULES: FilterRule[] = buildElementFilterRules();

export function isElementFilterSetting(value: unknown): value is ElementFilterSetting {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ElementFilterSetting>;
  return Boolean(
    ELEMENT_BLACKLIST_GROUPS.some((group) => group.id === candidate.groupId) &&
      typeof candidate.enabled === "boolean" &&
      typeof candidate.minimumConfidence === "number" &&
      Number.isFinite(candidate.minimumConfidence) &&
      candidate.minimumConfidence >= 0.05 &&
      candidate.minimumConfidence <= 0.95
  );
}

function normalizeConfidence(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(0.95, Math.max(0.05, value));
}

export function decideFilter(
  assessment: VisionAssessment,
  rules: readonly FilterRule[],
  now = new Date()
): FilterDecision {
  if (assessment.status === "error") {
    return {
      action: "blur",
      reasons: [],
      decidedAt: now.toISOString()
    };
  }

  const matches = rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({ rule, confidence: assessment.labels[rule.label] ?? 0 }))
    .filter(({ rule, confidence }) => confidence >= rule.minimumConfidence)
    .sort((left, right) => right.rule.priority - left.rule.priority);

  const strongest = matches[0];
  if (!strongest) {
    return { action: "allow", reasons: [], decidedAt: now.toISOString() };
  }

  return {
    action: strongest.rule.action,
    reasons: matches.map(({ rule, confidence }) => ({
      ruleId: rule.id,
      ruleName: rule.name,
      label: rule.label,
      confidence,
      threshold: rule.minimumConfidence
    })),
    decidedAt: now.toISOString()
  };
}
