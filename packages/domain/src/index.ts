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

export type WorkType = "illustration" | "manga" | "ugoira" | "local" | "unknown";
export type WorkOwnership = "managed" | "external";
export type AssetFileState = "available" | "missing" | "trashed" | "error";
export type DisplayProfile = "quality" | "balanced" | "efficient";

export interface AppearancePreferences {
  displayProfile: DisplayProfile;
  reducedMotion: boolean;
  ambientArtwork: boolean;
  customAvatarUrl?: string | null;
}

export type ThemeColorScheme = "dark" | "light" | "auto";

export interface ThemeManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  authorUrl?: string;
  description: string;
  colorScheme: ThemeColorScheme;
  cssEntry?: string;
  previewImage?: string;
  tags?: string[];
  minAppVersion?: string;
  isPreset?: boolean;
}

export interface InstalledTheme extends ThemeManifest {
  localPath: string;
  installedAt: number;
  isActive: boolean;
}

export interface ActiveTheme {
  themeId: string;
  cssContent: string;
  manifest?: ThemeManifest;
}

export interface StoreThemeItem {
  id: string;
  name: string;
  version: string;
  author: string;
  authorUrl?: string;
  description: string;
  colorScheme: ThemeColorScheme;
  tags: string[];
  previewImageUrl: string;
  downloadPath: string;
  stars?: number;
  updatedAt: string;
  installedVersion?: string;
}

export interface StoreCatalogResponse {
  themes: StoreThemeItem[];
  fetchedAt: number;
  fromCache: boolean;
  rateLimitRemaining: number;
  rateLimitResetAt: number;
}

export interface ThemeDownloadProgress {
  themeId: string;
  progress: number;
}

export interface ThemeChangedEvent {
  activeThemeId: string;
  cssContent: string;
}

export type GalleryDefaultView = "flat" | "collections" | "author-work";
export type GridDensity = "comfortable" | "compact";

export interface LibraryPreferences {
  defaultView: GalleryDefaultView;
  defaultSortBy: WorkSortField;
  defaultSortDirection: SortDirection;
  gridDensity: GridDensity;
  downloadDirectory: string | null;
}

export const DEFAULT_LIBRARY_PREFERENCES: LibraryPreferences = {
  defaultView: "flat",
  defaultSortBy: "savedAt",
  defaultSortDirection: "desc",
  gridDensity: "comfortable",
  downloadDirectory: null
};

/**
 * A user-visible work. Multi-page Pixiv works have one WorkRecord and many
 * WorkAssetRecords; ArtworkRecord remains the page-level compatibility model.
 */
export interface WorkRecord {
  id: string;
  sourcePlatform: "pixiv" | null;
  sourceWorkId: string | null;
  artistId: string | null;
  artistName: string | null;
  title: string;
  workType: WorkType;
  publishedAt: string | null;
  bookmarkedAt: string | null;
  savedAt: string;
  lastViewedAt: string | null;
  favorite: boolean;
  pageCount: number;
  coverAssetId: string | null;
  ownership: WorkOwnership;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  collectionIds: string[];
  assets: WorkAssetRecord[];
}

export interface WorkAssetRecord {
  id: string;
  workId: string;
  legacyArtworkId: string | null;
  pageIndex: number;
  path: string;
  mediaType: "image" | "ugoira" | "unknown";
  extension: string | null;
  width: number | null;
  height: number | null;
  byteLength: number | null;
  contentHash: string | null;
  thumbnailPath: string | null;
  fileState: AssetFileState;
  createdAt: string;
  updatedAt: string;
}

export type WorkSortField =
  | "savedAt"
  | "publishedAt"
  | "title"
  | "artist"
  | "pageCount"
  | "byteLength";
export type SortDirection = "asc" | "desc";
export type CollectionMatchMode = "all" | "any";

export interface SavedCollectionViewQuery {
  matchMode: CollectionMatchMode;
  includedCollectionIds: string[];
  excludedCollectionIds: string[];
}

export interface SavedCollectionView {
  id: string;
  name: string;
  matchMode: CollectionMatchMode;
  includedCollectionIds: string[];
  excludedCollectionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SavedCollectionViewDraft {
  name: string;
  matchMode: CollectionMatchMode;
  includedCollectionIds: string[];
  excludedCollectionIds: string[];
}

export interface WorkQuery {
  search?: string;
  workType?: WorkType;
  artistId?: string;
  collectionId?: string;
  collectionIds?: string[];
  collectionMatchMode?: CollectionMatchMode;
  excludedCollectionIds?: string[];
  sortBy?: WorkSortField;
  direction?: SortDirection;
  offset?: number;
  limit?: number;
}

export interface WorkListItem {
  id: string;
  sourcePlatform: "pixiv" | null;
  sourceWorkId: string | null;
  artistId: string | null;
  artistName: string | null;
  title: string;
  workType: WorkType;
  publishedAt: string | null;
  savedAt: string;
  favorite: boolean;
  pageCount: number;
  totalByteLength: number;
  ownership: WorkOwnership;
  collectionIds: string[];
  coverAsset: WorkAssetRecord | null;
}

export interface WorkQueryResult {
  items: WorkListItem[];
  total: number;
  totalPages: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface WorkDeletionPreviewItem {
  id: string;
  title: string;
  ownership: WorkOwnership;
  pageCount: number;
  fileCount: number;
  byteLength: number;
}

export interface WorkDeletionPreview {
  token: string;
  expiresAt: string;
  items: WorkDeletionPreviewItem[];
  managedWorkCount: number;
  externalWorkCount: number;
  fileCount: number;
  byteLength: number;
}

export interface WorkDeletionFailure {
  workId: string;
  title: string;
  message: string;
}

export interface WorkDeletionResult {
  completedWorkIds: string[];
  failures: WorkDeletionFailure[];
  trashedFileCount: number;
  removedExternalWorkCount: number;
}

export interface ArtistRecord {
  id: string;
  name: string;
  avatarUrl: string | null;
  avatarLocalPath: string | null;
  updatedAt: string;
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
  coverArtworkId?: string;
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

export interface CustomElementGroup extends ElementBlacklistGroup {
  aliases: string[];
  action: Exclude<FilterAction, "allow">;
}

export interface RuleSandboxResult {
  fileName: string;
  assessment: VisionAssessment;
  decision: FilterDecision;
}

export type AnalysisScope =
  | { type: "selected"; workIds: string[] }
  | { type: "artist"; artistId: string }
  | { type: "collection"; collectionId: string }
  | { type: "all" };

export interface AnalysisScopePreview {
  scope: AnalysisScope;
  workCount: number;
  assetCount: number;
  cachedAssetCount: number;
}

export type AnalysisJobStatus = "queued" | "running" | "completed" | "cancelled" | "failed";

export interface AnalysisSuggestion {
  id: string;
  label: string;
  averageConfidence: number;
  workIds: string[];
}

export interface AnalysisJob {
  id: string;
  scope: AnalysisScope;
  status: AnalysisJobStatus;
  engine: string;
  workCount: number;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  cacheHits: number;
  error: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  suggestions: AnalysisSuggestion[];
}

export interface AnalysisApplyResult {
  collectionIds: string[];
  affectedWorkCount: number;
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
  settings: readonly ElementFilterSetting[] = DEFAULT_ELEMENT_FILTER_SETTINGS,
  customGroups: readonly CustomElementGroup[] = []
): FilterRule[] {
  const settingsByGroup = new Map(settings.map((setting) => [setting.groupId, setting]));
  const groups: Array<ElementBlacklistGroup & {
    aliases: string[];
    action: Exclude<FilterAction, "allow">;
  }> = [
    ...ELEMENT_BLACKLIST_GROUPS.map((group) => ({ ...group, aliases: [], action: "hide" as const })),
    ...customGroups
  ];
  return groups.flatMap((group, groupIndex) => {
    const setting = settingsByGroup.get(group.id);
    const minimumConfidence = normalizeConfidence(
      setting?.minimumConfidence,
      group.defaultThreshold
    );
    const tags = [...group.tags, ...group.aliases];
    return [...new Set(tags)].map((tag) => ({
      id: `element-${group.id}-${tag}`,
      name: `${group.name}：${tag}`,
      enabled: setting?.enabled ?? true,
      label: tag,
      minimumConfidence,
      action: group.action,
      priority: 1_000 - groupIndex
    }));
  });
}

/**
 * Returns a deterministic fingerprint for the active element rules.
 * This is a cache namespace, not an integrity token.
 */
export function rulesFingerprint(
  settings: readonly ElementFilterSetting[] = DEFAULT_ELEMENT_FILTER_SETTINGS,
  customGroups: readonly CustomElementGroup[] = []
): string {
  const canonical = buildElementFilterRules(settings, customGroups)
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

export function isLibraryPreferences(value: unknown): value is LibraryPreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LibraryPreferences>;
  return (
    (candidate.defaultView === "flat" || candidate.defaultView === "collections" || candidate.defaultView === "author-work") &&
    (["savedAt", "publishedAt", "title", "artist", "pageCount", "byteLength"] as const).includes(candidate.defaultSortBy as WorkSortField) &&
    (candidate.defaultSortDirection === "asc" || candidate.defaultSortDirection === "desc") &&
    (candidate.gridDensity === "comfortable" || candidate.gridDensity === "compact") &&
    (candidate.downloadDirectory === null || typeof candidate.downloadDirectory === "string")
  );
}

export function isCustomElementGroup(value: unknown): value is CustomElementGroup {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CustomElementGroup>;
  const validStrings = (items: unknown): items is string[] =>
    Array.isArray(items) && items.length <= 64 && items.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 80);
  return Boolean(
    typeof candidate.id === "string" && /^custom-[a-z0-9-]{1,64}$/.test(candidate.id) &&
    typeof candidate.name === "string" && candidate.name.trim() && candidate.name.length <= 80 &&
    typeof candidate.description === "string" && candidate.description.length <= 300 &&
    validStrings(candidate.tags) && candidate.tags.length > 0 &&
    validStrings(candidate.aliases) &&
    typeof candidate.defaultThreshold === "number" && candidate.defaultThreshold >= 0.05 && candidate.defaultThreshold <= 0.95 &&
    (candidate.action === "blur" || candidate.action === "hide")
  );
}

export function isAnalysisScope(value: unknown): value is AnalysisScope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AnalysisScope> & Record<string, unknown>;
  if (candidate.type === "all") return true;
  if (candidate.type === "artist") return typeof candidate.artistId === "string" && candidate.artistId.length > 0 && candidate.artistId.length <= 200;
  if (candidate.type === "collection") return typeof candidate.collectionId === "string" && candidate.collectionId.length > 0 && candidate.collectionId.length <= 200;
  return candidate.type === "selected" && Array.isArray(candidate.workIds) && candidate.workIds.length <= 10_000 && candidate.workIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200);
}

export const DEFAULT_FILTER_RULES: FilterRule[] = buildElementFilterRules();

export function isElementFilterSetting(value: unknown): value is ElementFilterSetting {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ElementFilterSetting>;
  return Boolean(
    typeof candidate.groupId === "string" &&
      (ELEMENT_BLACKLIST_GROUPS.some((group) => group.id === candidate.groupId) || /^custom-[a-z0-9-]{1,64}$/.test(candidate.groupId)) &&
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
