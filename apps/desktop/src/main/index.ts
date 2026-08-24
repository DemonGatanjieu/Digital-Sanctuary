import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  nativeImage,
  protocol,
  screen,
  session,
  shell,
  type Session,
  WebContentsView
} from "electron";
import { LibraryDatabase, type RemoteImageReviewRecord } from "@sanctuary/database";
import {
  addTagToCustomGroups,
  buildElementFilterRules,
  decideFilter,
  DEFAULT_LIBRARY_PREFERENCES,
  isCustomElementGroup,
  isElementFilterSetting,
  isLibraryPreferences,
  rulesFingerprint,
  type AppearancePreferences,
  type ArtistRecord,
  type ArtworkRecord,
  type CustomElementGroup,
  type LibraryPreferences,
  type RuleSandboxResult,
  type VisionAssessment,
  type WorkDeletionPreview,
  type WorkDeletionResult,
  type InspectArtworkPage,
  type InspectArtworkResponse
} from "@sanctuary/domain";
import { VisionClient } from "./vision-client.js";
import type { VisionProcessOptions } from "./vision-client.js";
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
  undoFeedbackChanges,
  type AdaptivePreferenceFeedback,
  type PersonalTagPreferenceProfile
} from "./explore-preference-calibration.js";
import {
  ExploreReviewQueue,
  type ExploreReviewPriority
} from "./explore-review-queue.js";
import {
  describeInspectorFailure,
  inspectorImageCandidates
} from "./inspector-image-candidates.js";
import { fetchPixivReviewImage } from "./pixiv-review-fetch.js";
import {
  PIXIV_HOME_URL,
  PIXIV_LOGIN_URL,
  PIXIV_PASSWORD_SETUP_URL,
  PIXIV_SESSION_PARTITION,
  isAllowedPixivNavigation,
  isPixivArtworkImageUrl,
  normalizePixivArtworkImageUrl,
  parseExploreBounds,
  shouldAllowPixivLoginPermission,
  shouldBlockExploreAdRequest,
  shouldBlockExploreResource,
  type ExploreBounds
} from "./explore-policy.js";
import {
  buildPixivBlockedReviewScript,
  buildPixivDomAdapterScript,
  buildPixivReviewReleaseScript
} from "./pixiv-dom-adapter.js";
import {
  completedDownloadPhase,
  hasContiguousPixivPages,
  IDLE_EXPLORE_DOWNLOAD_STATE,
  parsePixivArtistProfile,
  parsePixivArtworkMetadata,
  parsePixivArtworkPages,
  parsePixivBookmarkPage,
  parsePixivPageContext,
  reachedConsecutiveFailureLimit,
  safePixivImageExtension,
  type ArtistAvatarRepairResult,
  type BookmarkDownloadPreview,
  type ExploreDownloadResult,
  type ExploreDownloadState,
  type PixivArtworkMetadata,
  type PixivArtworkPage
} from "../shared/pixiv-download.js";
import {
  AsyncTaskGate,
  mapWithConcurrency
} from "../shared/bounded-concurrency.js";
import { parseWorkId, parseWorkIds } from "../shared/library-query.js";
import { registerLibraryReadIpc } from "./library-ipc.js";
import { normalizeWindowState, type PersistedWindowState } from "./window-state.js";
import { AnalysisJobScheduler } from "./analysis-job-runner.js";
import { registerAnalysisIpc } from "./analysis-ipc.js";
import { registerSavedCollectionViewIpc } from "./saved-collection-view-ipc.js";
import { ThemeManagerService } from "./theme/theme-manager.js";
import { ThemeStoreService } from "./theme/theme-store.js";
import { registerThemeIpc } from "./theme/theme-ipc.js";
import { VisionSecretStore } from "./vision/vision-secret-store.js";
import { ExternalVisionService } from "./vision/external-vision-service.js";
import { FontService } from "./typography/font-service.js";
import { registerFontProtocol } from "./typography/font-protocol.js";
import { registerTypographyIpc } from "./typography/typography-ipc.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "sanctuary-image",
    privileges: { secure: true, standard: true, supportFetchAPI: true }
  },
  {
    scheme: "sanctuary-font",
    privileges: { secure: true, standard: true, supportFetchAPI: true }
  }
]);

let database: LibraryDatabase | undefined;
let vision: VisionClient | undefined;
let themeManager: ThemeManagerService | undefined;
let themeStore: ThemeStoreService | undefined;
let externalVisionService: ExternalVisionService | undefined;
let fontService: FontService | undefined;
let mainWindow: BrowserWindow | undefined;
let exploreView: WebContentsView | undefined;
let exploreBounds: ExploreBounds | undefined;
let exploreVisible = false;
let exploreBlockedResources = 0;
let exploreBlockedAds = 0;
let exploreApprovedResources = 0;
let explorePendingResources = 0;
let exploreRemoteReviewCacheHits = 0;
let exploreRemoteReviewCacheMisses = 0;
let exploreError = "";
let exploreStateTimer: ReturnType<typeof setTimeout> | undefined;
let exploreDownloadState: ExploreDownloadState = { ...IDLE_EXPLORE_DOWNLOAD_STATE };
let activeExploreDownload: Promise<ExploreDownloadResult> | undefined;
let activeArtistAvatarRepair: Promise<ArtistAvatarRepairResult> | undefined;
let windowStateTimer: ReturnType<typeof setTimeout> | undefined;
const analysisJobScheduler = new AnalysisJobScheduler();
interface RemoteReviewOutcome {
  state: "allowed" | "blocked" | "unavailable";
  reasons: string[];
  source: "memory" | "persistent" | "fresh" | "preference" | "error";
}

const remoteReviewCache = new Map<string, RemoteReviewOutcome>();
const remoteReviewPending = new Map<string, Promise<RemoteReviewOutcome>>();
const pendingDeletionPreviews = new Map<string, { workIds: string[]; expiresAt: number }>();
const exploreReviewQueue = new ExploreReviewQueue();
const pixivRevealToken = randomUUID();
const remoteOneShotAllows = new Set<string>();
let remoteVisionQueue: Promise<void> = Promise.resolve();
let exploreActiveReview: { normalizedUrl: string; generation: number } | undefined;
let exploreReviewGeneration = 0;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const MAX_ORIGINAL_IMAGE_BYTES = 128 * 1024 * 1024;
const MAX_MEMORY_REVIEW_CACHE_ENTRIES = 500;
const PIXIV_BOOKMARK_PAGE_SIZE = 48;
const PIXIV_DOWNLOAD_CONCURRENCY = 4;
const ENABLE_VIEWPORT_REVIEW = true;
const THRESHOLD_OVERRIDES_PREFERENCE_PREFIX = "filters.threshold-overrides.v1";
const PAGE_EXCEPTIONS_PREFERENCE = "filters.explore-page-exceptions.v1";
const DISLIKE_PAGE_EXCEPTIONS_PREFERENCE = "filters.explore-dislike-page-exceptions.v1";
const PERSONAL_TAG_PREFERENCES_PREFIX = "filters.personal-tag-preferences.v1";
const ADAPTIVE_FEEDBACK_PREFERENCE = "filters.adaptive-feedback.v1";
let exploreProtectionBypassed = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const pixivDownloadNetworkGate = new AsyncTaskGate(PIXIV_DOWNLOAD_CONCURRENCY);

interface ExploreState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  blockedResources: number;
  blockedAds: number;
  approvedResources: number;
  pendingResources: number;
  queuedResources: number;
  remoteReviewCacheHits: number;
  remoteReviewCacheMisses: number;
  error: string;
  protectionStatus: "starting" | "ready" | "failed" | "stopped" | "bypassed";
  protectionError: string;
  maximized: boolean;
  pageKind: "artwork" | "bookmarks" | "other";
  artworkId: string;
  bookmarkUserId: string;
  download: ExploreDownloadState;
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const userDataPath = app.getPath("userData");
    database = new LibraryDatabase(join(userDataPath, "library.db"));
    database.recoverInterruptedAnalysisJobs();
    if (process.env.SANCTUARY_BENCHMARK_LIBRARY === "1") {
      database.seedBenchmarkWorks(Number(process.env.SANCTUARY_BENCHMARK_WORKS ?? 10_000));
    }
    const startupProbeImage = join(userDataPath, ".vision-startup-probe.png");
    try {
      await writeFile(
        startupProbeImage,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64"
        )
      );
    } catch (error) {
      console.error("[vision] unable to prepare startup self-test image", error);
    }
    vision = new VisionClient({ ...resolveVisionProcess(), startupProbeImage });
    vision.onStateChange((snapshot) => {
      console.info(`[vision] runtime state=${snapshot.state} provider=${snapshot.executionProvider}`);
      syncExploreProtectionVisibility();
      scheduleExploreState();
      mainWindow?.webContents.send("app:status-changed", currentApplicationStatus());
    });
    void vision.initialize().catch((error: unknown) => {
      console.error("[vision] startup failed", error);
    });
    themeManager = new ThemeManagerService({
      bundledThemesPath: app.isPackaged
        ? join(process.resourcesPath, "themes")
        : resolve(moduleDirectory, "../../resources/themes"),
      userThemesPath: join(userDataPath, "themes"),
      readActiveThemeId: () => database?.getPreference<string>("active_theme_id") ?? "default",
      writeActiveThemeId: (themeId) => database?.setPreference("active_theme_id", themeId),
    });
    const themeRepository = parseThemeRepository(process.env.SANCTUARY_THEME_REPOSITORY);
    themeStore = new ThemeStoreService({
      manager: themeManager,
      cachePath: join(userDataPath, "theme-store-cache.json"),
      ...(themeRepository ? { owner: themeRepository.owner, repository: themeRepository.repository } : {}),
      ...(process.env.SANCTUARY_THEME_REF ? { ref: process.env.SANCTUARY_THEME_REF } : {}),
      ...(process.env.SANCTUARY_THEME_GITHUB_TOKEN
        ? { githubToken: process.env.SANCTUARY_THEME_GITHUB_TOKEN }
        : {}),
    });
    externalVisionService = new ExternalVisionService(
      new VisionSecretStore(join(userDataPath, "secrets"))
    );
    fontService = new FontService(userDataPath);
    registerFontProtocol(session.defaultSession, fontService);
    registerTypographyIpc(fontService, () => database, () => mainWindow);
    database.invalidateAssessmentsExcept(vision.engine);
    database.pruneRemoteImageReviews();
    registerImageProtocol();
    registerIpc();
    createWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (exploreStateTimer) clearTimeout(exploreStateTimer);
  if (windowStateTimer) clearTimeout(windowStateTimer);
  saveWindowState();
  vision?.close();
  database?.close();
});

function createWindow(): void {
  const savedState = readWindowState();
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const width = savedState?.width ?? Math.min(1440, primaryWorkArea.width);
  const height = savedState?.height ?? Math.min(900, primaryWorkArea.height);
  const window = new BrowserWindow({
    width,
    height,
    ...(savedState ? { x: savedState.x, y: savedState.y } : {}),
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#f7f8fa",
    title: "纯净领域",
    webPreferences: {
      preload: join(moduleDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: process.env.SANCTUARY_BENCHMARK_LIBRARY !== "1"
    }
  });
  mainWindow = window;
  if (!savedState) window.center();
  if (savedState?.maximized) window.maximize();
  window.on("maximize", scheduleExploreState);
  window.on("unmaximize", scheduleExploreState);
  window.on("move", scheduleWindowStateSave);
  window.on("resize", scheduleWindowStateSave);
  window.on("maximize", scheduleWindowStateSave);
  window.on("unmaximize", scheduleWindowStateSave);
  window.on("close", saveWindowState);
  window.on("closed", () => {
    exploreView = undefined;
    mainWindow = undefined;
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(moduleDirectory, "../renderer/index.html"));
  }
}

function readWindowState(): PersistedWindowState | null {
  return normalizeWindowState(
    database?.getPreference<unknown>("window.main"),
    screen.getAllDisplays().map((display) => display.workArea)
  );
}

function scheduleWindowStateSave(): void {
  if (windowStateTimer) clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(saveWindowState, 300);
}

function saveWindowState(): void {
  if (windowStateTimer) {
    clearTimeout(windowStateTimer);
    windowStateTimer = undefined;
  }
  if (!database || !mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  const bounds = mainWindow.getNormalBounds();
  database.setPreference("window.main", {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized: mainWindow.isMaximized()
  } satisfies PersistedWindowState);
}

function parseCollectionDraft(value: unknown): { name: string; description: string } | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { name?: unknown; description?: unknown };
  if (typeof candidate.name !== "string" || typeof candidate.description !== "string") return null;
  const name = candidate.name.trim();
  const description = candidate.description.trim();
  if (!name || name.length > 80 || description.length > 500) return null;
  return { name, description };
}

function parseAppearancePreferences(value: unknown): AppearancePreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AppearancePreferences>;
  if (
    candidate.displayProfile !== "quality" &&
    candidate.displayProfile !== "balanced" &&
    candidate.displayProfile !== "efficient"
  ) return null;
  if (typeof candidate.reducedMotion !== "boolean" || typeof candidate.ambientArtwork !== "boolean") {
    return null;
  }
  return {
    displayProfile: candidate.displayProfile,
    reducedMotion: candidate.reducedMotion,
    ambientArtwork: candidate.ambientArtwork,
    customAvatarUrl:
      typeof candidate.customAvatarUrl === "string" &&
      (candidate.customAvatarUrl.startsWith("data:image/") || candidate.customAvatarUrl.startsWith("sanctuary-image:") || candidate.customAvatarUrl.startsWith("http")) &&
      candidate.customAvatarUrl.length <= 2_500_000
        ? candidate.customAvatarUrl
        : null
  };
}

function libraryPreferences(): LibraryPreferences {
  const stored = database?.getPreference<unknown>("library.preferences");
  return isLibraryPreferences(stored) ? stored : { ...DEFAULT_LIBRARY_PREFERENCES };
}

function customElementGroups(): CustomElementGroup[] {
  const stored = database?.getPreference<unknown>("filters.custom-groups");
  return Array.isArray(stored) ? stored.filter(isCustomElementGroup) : [];
}

function thresholdOverridesPreferenceKey(
  engine = vision?.engine ?? "unavailable",
  engineVersion = vision?.engineVersion ?? "0"
): string {
  return `${THRESHOLD_OVERRIDES_PREFERENCE_PREFIX}:${engine}:${engineVersion}`;
}

function adaptiveThresholdOverrides(
  engine = vision?.engine ?? "unavailable",
  engineVersion = vision?.engineVersion ?? "0"
): Record<string, number> {
  return normalizeThresholdOverrides(
    database?.getPreference<unknown>(thresholdOverridesPreferenceKey(engine, engineVersion))
  );
}

function personalTagPreferencesKey(
  engine = vision?.engine ?? "unavailable",
  engineVersion = vision?.engineVersion ?? "0"
): string {
  return `${PERSONAL_TAG_PREFERENCES_PREFIX}:${engine}:${engineVersion}`;
}

function personalTagPreferences(
  engine = vision?.engine ?? "unavailable",
  engineVersion = vision?.engineVersion ?? "0"
): PersonalTagPreferenceProfile {
  return normalizePersonalTagPreferences(
    database?.getPreference<unknown>(personalTagPreferencesKey(engine, engineVersion))
  );
}

function explorePageExceptions(): string[] {
  return normalizePageExceptions(
    database?.getPreference<unknown>(PAGE_EXCEPTIONS_PREFERENCE)
  );
}

function exploreDislikePageExceptions(): string[] {
  return normalizePageExceptions(
    database?.getPreference<unknown>(DISLIKE_PAGE_EXCEPTIONS_PREFERENCE)
  );
}

function adaptiveFeedbackHistory(): AdaptivePreferenceFeedback[] {
  return normalizeFeedbackHistory(
    database?.getPreference<unknown>(ADAPTIVE_FEEDBACK_PREFERENCE)
  );
}

function isExplorePageException(imageUrl: string): boolean {
  const pageKey = pixivArtworkPageKey(imageUrl);
  return Boolean(pageKey && explorePageExceptions().includes(pageKey));
}

function isExploreDislikePageException(imageUrl: string): boolean {
  const pageKey = pixivArtworkPageKey(imageUrl);
  return Boolean(pageKey && exploreDislikePageExceptions().includes(pageKey));
}

function activeExploreRulesFingerprint(
  settings: ReturnType<LibraryDatabase["listElementFilterSettings"]>,
  preferences = personalTagPreferences()
): string {
  const base = rulesFingerprint(settings, customElementGroups(), adaptiveThresholdOverrides());
  const personal = personalPreferenceFingerprint(preferences);
  return personal ? `${base}|${personal}` : base;
}

async function deleteConfirmedWorks(workIds: readonly string[]): Promise<WorkDeletionResult> {
  const target = database;
  if (!target) throw new Error("Application is not ready");
  const result: WorkDeletionResult = {
    completedWorkIds: [],
    failures: [],
    trashedFileCount: 0,
    removedExternalWorkCount: 0
  };
  for (const workId of workIds) {
    const work = target.getWork(workId);
    if (!work) continue;
    if (work.ownership === "external") {
      if (target.removeWorkFromIndex(work.id)) {
        result.completedWorkIds.push(work.id);
        result.removedExternalWorkCount += 1;
      }
      continue;
    }

    let failure = "";
    for (const asset of work.assets) {
      if (!existsSync(asset.path)) {
        target.updateAssetFileState(asset.id, "missing");
        continue;
      }
      try {
        await shell.trashItem(asset.path);
        target.updateAssetFileState(asset.id, "trashed");
        result.trashedFileCount += 1;
      } catch (error) {
        target.updateAssetFileState(asset.id, "error");
        failure = error instanceof Error ? error.message : "Unable to move file to recycle bin";
        break;
      }
    }
    if (failure) {
      result.failures.push({ workId: work.id, title: work.title, message: failure });
      continue;
    }
    if (target.removeWorkFromIndex(work.id)) result.completedWorkIds.push(work.id);
  }
  return result;
}

function registerImageProtocol(): void {
  protocol.handle("sanctuary-image", (request) => {
    const imagePath = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const isArtwork = database?.hasArtworkPath(imagePath) ?? false;
    const isAvatar = database?.hasAvatarPath(imagePath) ?? false;
    if ((!isArtwork && !isAvatar) || !existsSync(imagePath)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(imagePath).toString());
  });
}

function localImageUrl(imagePath: string): string {
  return imagePath ? `sanctuary-image://local/${encodeURIComponent(imagePath)}` : "";
}

function registerIpc(): void {
  if (!database || !vision || !themeManager || !themeStore) throw new Error("Application services are unavailable");
  registerAnalysisIpc(ipcMain, database, vision, analysisJobScheduler, externalVisionService);
  registerSavedCollectionViewIpc(ipcMain, database);
  registerThemeIpc({
    ipc: ipcMain,
    dialog,
    manager: themeManager,
    store: themeStore,
    emitThemeChanged: (event) => mainWindow?.webContents.send("themes:changed", event),
    emitDownloadProgress: (event) => mainWindow?.webContents.send("themes:download-progress", event),
  });
  registerLibraryReadIpc(ipcMain, database, join(app.getPath("userData"), "thumbnails"), encodeLocalThumbnail);
  ipcMain.handle("library:create-backup", async (): Promise<string | null> => {
    if (!database || !mainWindow) throw new Error("Application is not ready");
    const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    const selected = await dialog.showSaveDialog(mainWindow, {
      title: "备份纯净领域数据库",
      defaultPath: join(app.getPath("documents"), `Digital-Sanctuary-${timestamp}.db`),
      filters: [{ name: "SQLite 数据库", extensions: ["db"] }]
    });
    if (selected.canceled || !selected.filePath) return null;
    if (existsSync(selected.filePath)) throw new Error("为避免覆盖已有备份，请选择一个新的文件名");
    return database.backupTo(resolve(selected.filePath));
  });
  ipcMain.handle("library:delete-preview", (_event, value: unknown): WorkDeletionPreview => {
    if (!database) throw new Error("Application is not ready");
    const workIds = parseWorkIds(value);
    if (!workIds) throw new Error("Invalid work selection");
    const items = workIds.flatMap((workId) => {
      const work = database?.getWork(workId);
      if (!work) return [];
      return [{
        id: work.id,
        title: work.title,
        ownership: work.ownership,
        pageCount: work.pageCount,
        fileCount: work.assets.length,
        byteLength: work.assets.reduce((total, asset) => total + (asset.byteLength ?? 0), 0)
      }];
    });
    if (items.length === 0) throw new Error("Selected works no longer exist");
    const token = randomUUID();
    const expiresAt = Date.now() + 5 * 60 * 1_000;
    pendingDeletionPreviews.set(token, { workIds: items.map((item) => item.id), expiresAt });
    for (const [staleToken, preview] of pendingDeletionPreviews) {
      if (preview.expiresAt < Date.now()) pendingDeletionPreviews.delete(staleToken);
    }
    return {
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      items,
      managedWorkCount: items.filter((item) => item.ownership === "managed").length,
      externalWorkCount: items.filter((item) => item.ownership === "external").length,
      fileCount: items.reduce((total, item) => total + item.fileCount, 0),
      byteLength: items.reduce((total, item) => total + item.byteLength, 0)
    };
  });
  ipcMain.handle("library:delete-confirmed", async (_event, value: unknown): Promise<WorkDeletionResult> => {
    if (!database || typeof value !== "string" || value.length > 100) {
      throw new Error("Invalid deletion confirmation");
    }
    const preview = pendingDeletionPreviews.get(value);
    pendingDeletionPreviews.delete(value);
    if (!preview || preview.expiresAt < Date.now()) throw new Error("Deletion preview expired");
    return deleteConfirmedWorks(preview.workIds);
  });
  ipcMain.handle("collections:list", () => database?.listCollections() ?? []);
  ipcMain.handle("artists:list", () => database?.listArtists() ?? []);
  ipcMain.handle("artists:repair-avatars", () => repairMissingArtistAvatars());

  ipcMain.handle("library:import", async () => {
    if (!database || !vision) throw new Error("Application is not ready");
    const selected = await dialog.showOpenDialog({
      title: "选择要加入纯净领域的图片",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif", "avif"] }
      ]
    });
    if (selected.canceled) return database.listArtworks();

    for (const imagePath of selected.filePaths) {
      const artwork = database.importArtwork(imagePath);
      database.trustArtwork(artwork.id);
    }
    return database.listArtworks();
  });

  ipcMain.handle("filters:list", () => database?.listElementFilterSettings() ?? []);
  ipcMain.handle("filters:custom-list", () => customElementGroups());
  ipcMain.handle("filters:personal-preferences-list", () => ({
    engine: vision?.engine ?? "unavailable",
    engineVersion: vision?.engineVersion ?? "0",
    available: Boolean(vision?.available),
    entries: Object.values(personalTagPreferences())
      .sort((left, right) => right.evidenceCount - left.evidenceCount || right.weight - left.weight)
  }));
  ipcMain.handle("filters:personal-preference-toggle", (_event, value: unknown) => {
    if (!database || !vision) throw new Error("本地视觉模型尚未就绪");
    if (!value || typeof value !== "object") throw new Error("Invalid personal preference payload");
    const { label, enabled } = value as { label?: unknown; enabled?: unknown };
    if (typeof label !== "string" || typeof enabled !== "boolean") {
      throw new Error("Invalid personal preference payload");
    }
    const current = personalTagPreferences();
    const preference = current[label];
    if (!preference) throw new Error("Personal preference was not found");
    const next = {
      ...current,
      [label]: { ...preference, enabled, updatedAt: new Date().toISOString() }
    };
    database.setPreference(personalTagPreferencesKey(), next);
    remoteReviewCache.clear();
    return {
      engine: vision.engine,
      engineVersion: vision.engineVersion,
      available: vision.available,
      entries: Object.values(next)
        .sort((left, right) => right.evidenceCount - left.evidenceCount || right.weight - left.weight)
    };
  });
  ipcMain.handle("filters:personal-preferences-reset", () => {
    if (!database || !vision) throw new Error("本地视觉模型尚未就绪");
    database.setPreference(personalTagPreferencesKey(), {});
    remoteReviewCache.clear();
    return {
      engine: vision.engine,
      engineVersion: vision.engineVersion,
      available: vision.available,
      entries: []
    };
  });
  ipcMain.handle("filters:update", (_event, setting: unknown) => {
    if (!database || !isElementFilterSetting(setting)) {
      throw new Error("Invalid element filter setting");
    }
    database.saveElementFilterSetting(setting);
    database.clearRemoteImageReviews();
    recalculateStoredDecisions(database);
    remoteReviewCache.clear();
    return database.listElementFilterSettings();
  });
  ipcMain.handle("filters:custom-update", (_event, value: unknown): CustomElementGroup[] => {
    if (!database || !Array.isArray(value) || value.length > 32 || !value.every(isCustomElementGroup)) {
      throw new Error("Invalid custom element groups");
    }
    const uniqueIds = new Set(value.map((group) => group.id));
    if (uniqueIds.size !== value.length) throw new Error("Custom element group ids must be unique");
    database.setPreference("filters.custom-groups", value);
    const existingSettings = new Map(database.listElementFilterSettings().map((setting) => [setting.groupId, setting]));
    for (const group of value) {
      if (!existingSettings.has(group.id)) {
        database.saveElementFilterSetting({ groupId: group.id, enabled: true, minimumConfidence: group.defaultThreshold });
      }
    }
    database.clearRemoteImageReviews();
    recalculateStoredDecisions(database);
    return value;
  });
  ipcMain.handle("filters:add-blacklist-tag", async (_event, value: unknown): Promise<CustomElementGroup[]> => {
    if (!database) throw new Error("Database is not ready");
    if (!value || typeof value !== "object") throw new Error("Invalid tag blacklist payload");
    const { tag, threshold, action, groupName } = value as { tag?: unknown; threshold?: unknown; action?: unknown; groupName?: unknown };
    if (typeof tag !== "string" || !tag.trim()) throw new Error("Tag must be a non-empty string");

    const current = customElementGroups();
    const options: { threshold?: number; action?: "blur" | "hide"; groupName?: string } = {
      action: action === "blur" ? "blur" : "hide"
    };
    if (typeof threshold === "number") options.threshold = threshold;
    if (typeof groupName === "string" && groupName.trim()) options.groupName = groupName.trim();

    const nextGroups = addTagToCustomGroups(current, tag, options);

    database.setPreference("filters.custom-groups", nextGroups);
    const existingSettings = new Map(database.listElementFilterSettings().map((setting) => [setting.groupId, setting]));
    for (const group of nextGroups) {
      if (!existingSettings.has(group.id)) {
        database.saveElementFilterSetting({ groupId: group.id, enabled: true, minimumConfidence: group.defaultThreshold });
      }
    }
    database.clearRemoteImageReviews();
    recalculateStoredDecisions(database);
    remoteReviewCache.clear();
    return nextGroups;
  });
  ipcMain.handle("vision:inspect-artwork", async (_event, value: unknown): Promise<InspectArtworkResponse | null> => {
    if (!database || !vision?.available) throw new Error("本地视觉模型尚未就绪，画廊图片仍可正常浏览");
    if (!value || typeof value !== "object") throw new Error("Invalid inspect payload");
    const { workId, artworkId, url, pageIndex } = value as {
      workId?: unknown;
      artworkId?: unknown;
      url?: unknown;
      pageIndex?: unknown;
    };

    const inspectPreferences = personalTagPreferences();
    const fingerprint = activeExploreRulesFingerprint(
      database.listElementFilterSettings(),
      inspectPreferences
    );
    const reviewSession = exploreView?.webContents.session ?? session.defaultSession;
    const requestedPageIndex = typeof pageIndex === "number" && pageIndex >= 0 ? pageIndex : undefined;

    // 1. Local Database Work
    if (typeof workId === "string" && workId.trim()) {
      const work = database.getWork(workId);
      if (work) {
        const pages: InspectArtworkPage[] = work.assets.map((a, i) => ({
          pageIndex: i,
          thumbUrl: localImageUrl(a.path),
          regularUrl: localImageUrl(a.path)
        }));
        const activeIdx = requestedPageIndex !== undefined && requestedPageIndex < pages.length ? requestedPageIndex : 0;
        const activeAsset = work.assets[activeIdx] || work.assets[0];
        let assessment: VisionAssessment | null = null;
        if (activeAsset?.path && existsSync(activeAsset.path)) {
          assessment = database.getCachedAssetAnalysis(
            activeAsset.id,
            activeAsset.updatedAt,
            vision.engine
          ) ?? await classifyFailClosed(vision, activeAsset.path, 30_000);
        }
        return {
          assessment,
          artworkId: work.id,
          title: work.title,
          url: localImageUrl(activeAsset?.path || ""),
          pageCount: Math.max(1, pages.length),
          activePageIndex: activeIdx,
          pages: pages.length > 0 ? pages : [{
            pageIndex: 0,
            thumbUrl: localImageUrl(activeAsset?.path || ""),
            regularUrl: localImageUrl(activeAsset?.path || "")
          }]
        };
      }
    }

    let trimmedArtworkId = typeof artworkId === "string" && /^\d+$/.test(artworkId.trim()) ? artworkId.trim() : "";
    if (!trimmedArtworkId && typeof url === "string") {
      const match = url.match(/\/(\d+)_(?:p\d+|_|\.)/);
      if (match && match[1]) trimmedArtworkId = match[1];
    }

    // 2. Multi-page Metadata Discovery via Pixiv Ajax API
    let pages: InspectArtworkPage[] = [];
    let illustTitle = "";
    let totalPageCount = 1;

    if (trimmedArtworkId) {
      try {
        const userAgent = exploreView?.webContents.getUserAgent() || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
        const response = await reviewSession.fetch(`https://www.pixiv.net/ajax/illust/${trimmedArtworkId}?lang=zh`, {
          headers: {
            Referer: `https://www.pixiv.net/artworks/${trimmedArtworkId}`,
            "User-Agent": userAgent,
            Accept: "application/json"
          }
        });
        if (response.ok) {
          const data = (await response.json()) as {
            error?: boolean;
            body?: {
              title?: string;
              pageCount?: number;
              urls?: { regular?: string; small?: string; thumb?: string; original?: string };
            };
          };
          if (!data.error && data.body) {
            illustTitle = data.body.title || "";
            totalPageCount = data.body.pageCount || 1;
            if (totalPageCount > 1) {
              const pagesResp = await reviewSession.fetch(`https://www.pixiv.net/ajax/illust/${trimmedArtworkId}/pages?lang=zh`, {
                headers: {
                  Referer: `https://www.pixiv.net/artworks/${trimmedArtworkId}`,
                  "User-Agent": userAgent,
                  Accept: "application/json"
                }
              });
              if (pagesResp.ok) {
                const pagesData = (await pagesResp.json()) as {
                  error?: boolean;
                  body?: Array<{ urls?: { thumb_mini?: string; small?: string; regular?: string; original?: string } }>;
                };
                if (!pagesData.error && Array.isArray(pagesData.body)) {
                  pages = pagesData.body.map((p, i) => ({
                    pageIndex: i,
                    thumbUrl: p.urls?.thumb_mini || p.urls?.small || p.urls?.regular || "",
                    regularUrl: p.urls?.regular || p.urls?.original || p.urls?.small || ""
                  }));
                }
              }
            } else if (data.body.urls) {
              const u = data.body.urls;
              pages = [{
                pageIndex: 0,
                thumbUrl: u.thumb || u.small || u.regular || "",
                regularUrl: u.regular || u.original || u.small || ""
              }];
            }
          }
        }
      } catch (err) {
        console.warn("[vision-inspect] failed to fetch pixiv ajax illust:", err);
      }
    }

    // Determine active page index
    let activePageIndex = 0;
    if (requestedPageIndex !== undefined && pages.length > 0 && requestedPageIndex < pages.length) {
      activePageIndex = requestedPageIndex;
    } else if (typeof url === "string" && url.trim()) {
      const pageMatch = url.match(/_p(\d+)(?:_|\.)/);
      if (pageMatch && pageMatch[1]) {
        const parsed = parseInt(pageMatch[1], 10);
        if (pages.length === 0 || parsed < pages.length) activePageIndex = parsed;
      }
    }

    const targetImageUrls = inspectorImageCandidates(url, pages, activePageIndex);
    if (targetImageUrls.length === 0 && trimmedArtworkId) {
      const works = database.queryWorks({ search: trimmedArtworkId, limit: 1 });
      const localMatch = works.items.find((w) => w.sourceWorkId === trimmedArtworkId || w.id === trimmedArtworkId);
      const localAsset = localMatch?.coverAsset;
      if (localAsset?.path && existsSync(localAsset.path)) {
        const assessment = database.getCachedAssetAnalysis(
          localAsset.id,
          localAsset.updatedAt,
          vision.engine
        ) ?? await classifyFailClosed(vision, localAsset.path, 30_000);
        return {
          assessment,
          artworkId: trimmedArtworkId,
          title: localMatch?.title || "",
          url: localImageUrl(localAsset.path),
          pageCount: 1,
          activePageIndex: 0,
          pages: [{
            pageIndex: 0,
            thumbUrl: localImageUrl(localAsset.path),
            regularUrl: localImageUrl(localAsset.path)
          }]
        };
      }
    }

    if (targetImageUrls.length === 0) {
      throw new Error(`本地 WD Tagger 已就绪（${vision.executionProvider}），但页面没有提供可供分析的 Pixiv 图片。`);
    }

    const responseFor = (assessment: VisionAssessment, targetImageUrl: string): InspectArtworkResponse => ({
      assessment,
      artworkId: trimmedArtworkId || undefined,
      title: illustTitle || undefined,
      url: targetImageUrl,
      pageCount: Math.max(1, pages.length || totalPageCount || 1),
      activePageIndex,
      pages: pages.length > 0 ? pages : [{ pageIndex: activePageIndex, thumbUrl: targetImageUrl, regularUrl: targetImageUrl }]
    });

    for (const targetImageUrl of targetImageUrls) {
      const persisted = database.getRemoteImageReview({
        normalizedUrl: targetImageUrl,
        engine: vision.engine,
        engineVersion: vision.engineVersion,
        rulesFingerprint: fingerprint
      });
      const reusable = persisted ?? database.getLatestRemoteImageReview(targetImageUrl);
      if (
        reusable?.assessment.status === "complete" &&
        reusable.engine === vision.engine &&
        reusable.engineVersion === vision.engineVersion
      ) {
        return responseFor(reusable.assessment, targetImageUrl);
      }
    }

    let lastFailure: unknown = new Error("Pixiv image is unavailable");
    for (const targetImageUrl of targetImageUrls) {
      try {
        const outcome = await performRemoteArtworkReview(
          targetImageUrl,
          trimmedArtworkId ? `https://www.pixiv.net/artworks/${trimmedArtworkId}` : PIXIV_HOME_URL,
          {
            normalizedUrl: targetImageUrl,
            engine: vision.engine,
            engineVersion: vision.engineVersion,
            rulesFingerprint: fingerprint
          },
          database.listElementFilterSettings(),
          inspectPreferences
        );
        database.saveRemoteImageReview(outcome);
        return responseFor(outcome.assessment, targetImageUrl);
      } catch (error) {
        lastFailure = error;
        console.warn(`[vision-inspect] candidate failed ${targetImageUrl}`, error);
      }
    }

    throw new Error(describeInspectorFailure(lastFailure, {
      available: vision.available,
      engine: vision.engine,
      executionProvider: vision.executionProvider,
      error: vision.error
    }));
  });
  ipcMain.handle("filters:test-image", async (): Promise<RuleSandboxResult | null> => {
    if (!database || !vision?.available || !mainWindow) throw new Error("本地视觉模型尚未就绪");
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: "选择规则测试图片",
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }]
    });
    const path = selected.filePaths[0];
    if (selected.canceled || !path) return null;
    const assessment = await classifyFailClosed(vision, path, 30_000);
    const decision = decideFilter(
      assessment,
      buildElementFilterRules(database.listElementFilterSettings(), customElementGroups())
    );
    return { fileName: basename(path), assessment, decision };
  });

  ipcMain.handle("explore:show", (_event, bounds: unknown) => {
    const parsedBounds = parseExploreBounds(bounds);
    if (!parsedBounds) throw new Error("Invalid exploration bounds");
    exploreBounds = parsedBounds;
    exploreVisible = true;
    syncExploreProtectionVisibility();
    scheduleExploreState();
    return currentExploreState();
  });
  ipcMain.handle("explore:set-bounds", (_event, bounds: unknown) => {
    const parsedBounds = parseExploreBounds(bounds);
    if (!parsedBounds) return false;
    exploreBounds = parsedBounds;
    if (exploreView && exploreVisible) exploreView.setBounds(parsedBounds);
    return true;
  });
  ipcMain.handle("explore:hide", () => {
    exploreVisible = false;
    exploreView?.setVisible(false);
  });
  ipcMain.handle("explore:command", async (_event, command: unknown) => {
    if (command === "retry-vision") {
      exploreProtectionBypassed = false;
      exploreView?.setVisible(false);
      resetExploreReviewQueue();
      if (!vision) throw new Error("Vision runtime is unavailable");
      void vision.restart().catch((error: unknown) => {
        console.error("[vision] restart failed", error);
      });
      scheduleExploreState();
      return currentExploreState();
    }
    if (command === "browse-unprotected") {
      exploreProtectionBypassed = true;
      resetExploreReviewQueue();
      syncExploreProtectionVisibility();
      sendExploreProtectionMode();
      scheduleExploreState();
      return currentExploreState();
    }
    if (command === "resume-protection") {
      exploreProtectionBypassed = false;
      resetExploreReviewQueue();
      syncExploreProtectionVisibility();
      sendExploreProtectionMode();
      if (vision?.available) exploreView?.webContents.reload();
      scheduleExploreState();
      return currentExploreState();
    }
    if (command === "maximize" && mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
      scheduleExploreState();
      return currentExploreState();
    }
    if (!vision?.available && !exploreProtectionBypassed) {
      throw new Error("本地保护模型尚未就绪");
    }
    const view = ensureExploreView();
    const history = view.webContents.navigationHistory;
    if (command === "home") {
      void view.webContents.loadURL(PIXIV_HOME_URL);
    }
    else if (command === "login") {
      void view.webContents.loadURL(PIXIV_LOGIN_URL);
    }
    else if (command === "open-password-setup") {
      await shell.openExternal(PIXIV_PASSWORD_SETUP_URL);
    }
    else if (command === "back" && history.canGoBack()) history.goBack();
    else if (command === "forward" && history.canGoForward()) history.goForward();
    else if (command === "reload") view.webContents.reload();
    else if (!['home', 'login', 'open-password-setup', 'back', 'forward', 'reload', 'maximize'].includes(String(command))) {
      throw new Error("Invalid exploration command");
    }
    scheduleExploreState();
    return currentExploreState();
  });
  ipcMain.handle("explore:state", () => currentExploreState());
  ipcMain.handle("explore:download-current", () => downloadCurrentPixivArtwork());
  ipcMain.handle("explore:bookmarks-preview", async (): Promise<BookmarkDownloadPreview> => {
    const context = parsePixivPageContext(exploreView?.webContents.getURL() ?? "");
    if (context.kind !== "bookmarks") {
      throw new Error("请先进入 Pixiv 的收藏作品页");
    }
    const session = requireExploreSession();
    const total = await fetchPixivBookmarkTotal(session, context.bookmarkUserId);
    return { userId: context.bookmarkUserId, total };
  });
  ipcMain.handle("explore:download-bookmarks", () => {
    const context = parsePixivPageContext(exploreView?.webContents.getURL() ?? "");
    if (context.kind !== "bookmarks") {
      throw new Error("请先进入 Pixiv 的收藏作品页");
    }
    return startExploreDownload("bookmarks", async () => {
      updateExploreDownloadState({
        phase: "discovering",
        message: "正在分页读取公开与非公开收藏…"
      });
      const artworkIds = await fetchAllPixivBookmarkIds(
        requireExploreSession(),
        context.bookmarkUserId
      );
      updateExploreDownloadState({
        phase: "downloading",
        totalArtworks: artworkIds.length,
        message: artworkIds.length > 0 ? "准备下载收藏作品…" : "收藏中没有作品"
      });

      let completedArtworks = 0;
      let failedArtworks = 0;
      let downloadedPages = 0;
      let skippedPages = 0;
      let consecutiveFailures = 0;
      let lastFailure = "";
      await mapWithConcurrency(
        artworkIds,
        1, // 降级为单线程顺序执行，避免触发 P 站反爬虫
        async (artworkId, index) => {
          updateExploreDownloadState({
            message: `正在保存作品 ${artworkId}（任务 ${index + 1}/${artworkIds.length}）`
          });
          let fastPathed = false;
          try {
            const result = await downloadPixivArtwork(artworkId, false, true);
            downloadedPages += result.downloadedPages;
            skippedPages += result.skippedPages;
            completedArtworks += 1;
            consecutiveFailures = 0;
            fastPathed = !!result.fastPathed;
          } catch (error) {
            if (error instanceof PixivBatchAbortError) throw error;
            failedArtworks += 1;
            consecutiveFailures += 1;
            const reason = errorMessage(error);
            lastFailure = `${artworkId}：${reason}`;
            console.error(`[pixiv-download] artwork ${artworkId}: ${reason}`, error);
            fastPathed = false;
            updateExploreDownloadState({
              completedArtworks,
              failedArtworks,
              lastFailure,
              message: `作品 ${artworkId} 保存失败：${reason}`
            });
            if (reachedConsecutiveFailureLimit(consecutiveFailures)) {
              throw new PixivBatchAbortError(
                `连续 ${consecutiveFailures} 个作品失败，任务已自动停止。最后失败：${lastFailure}`
              );
            }
          }
          updateExploreDownloadState({ completedArtworks, failedArtworks, lastFailure });

          // 如果没有命中快速跳过（即发起了真实网络请求，或者请求失败报错了），则强制加入随机安全延时 (Jitter)
          // 必须放在 try-catch 外，防止出现报错时瞬间无延迟重试导致死循环刷爆 P 站
          if (!fastPathed && index < artworkIds.length - 1) {
            const jitterMs = Math.floor(2000 + Math.random() * 2000); // 2s - 4s
            updateExploreDownloadState({
              message: `防封禁延时 ${jitterMs / 1000} 秒...（任务 ${index + 1}/${artworkIds.length}）`
            });
            await new Promise((resolve) => setTimeout(resolve, jitterMs));
          }
        }
      );

      return {
        completedArtworks,
        failedArtworks,
        downloadedPages,
        skippedPages,
        lastFailure,
        destination: pixivGalleryDirectory()
      };
    });
  });
  ipcMain.on("explore:review-candidate", (event, value: unknown) => {
    const contents = exploreView?.webContents;
    if (!contents || contents.isDestroyed() || event.sender.id !== contents.id) return;
    if (!isExploreReviewCandidateMessage(value)) return;
    const normalizedUrl = normalizePixivArtworkImageUrl(value.normalizedUrl);
    if (!normalizedUrl || !isAllowedPixivNavigation(value.referrer)) return;
    enqueueExploreReview(contents, normalizedUrl, value.referrer, value.priority);
  });
  ipcMain.on("explore:review-inactive", (event, value: unknown) => {
    const contents = exploreView?.webContents;
    if (!contents || contents.isDestroyed() || event.sender.id !== contents.id) return;
    const normalizedUrl = normalizeExploreReviewInactiveMessage(value);
    if (!normalizedUrl || exploreActiveReview?.normalizedUrl === normalizedUrl) return;
    if (exploreReviewQueue.remove(normalizedUrl)) scheduleExploreState();
  });
  ipcMain.on("explore:reveal-artwork", (event, value: unknown) => {
    const contents = exploreView?.webContents;
    if (!contents || contents.isDestroyed() || event.sender.id !== contents.id) return;
    if (!value || typeof value !== "object") return;
    const rawUrl = (value as { normalizedUrl?: unknown }).normalizedUrl;
    if (typeof rawUrl !== "string") return;
    const normalizedUrl = normalizePixivArtworkImageUrl(rawUrl);
    if (!normalizedUrl) return;
    remoteOneShotAllows.add(normalizedUrl);
    contents.send("explore:review-result", {
      normalizedUrl,
      state: "allowed",
      reasons: []
    });
  });
  ipcMain.handle("explore:get-dislike-candidates", async (event, value: unknown) => {
    const contents = exploreView?.webContents;
    if (!contents || contents.isDestroyed() || event.sender.id !== contents.id) {
      return { success: false, candidates: [] };
    }
    if (!database || !vision?.available) throw new Error("本地视觉模型尚未就绪");
    if (!value || typeof value !== "object") throw new Error("Invalid payload");
    const rawUrl = (value as { normalizedUrl?: unknown }).normalizedUrl;
    if (typeof rawUrl !== "string") throw new Error("Missing normalizedUrl");
    const normalizedUrl = normalizePixivArtworkImageUrl(rawUrl);
    if (!normalizedUrl) throw new Error("无法识别这张 Pixiv 图片");
    const reviewRecord = database.getLatestRemoteImageReview(normalizedUrl);
    if (
      !reviewRecord || reviewRecord.assessment.status !== "complete" ||
      reviewRecord.engine !== vision.engine || reviewRecord.engineVersion !== vision.engineVersion
    ) {
      throw new Error("这张图片尚未完成本地分析，请稍后再试");
    }
    return {
      success: true,
      pageKey: pixivArtworkPageKey(normalizedUrl),
      candidates: selectDislikeTagCandidates({
        assessment: reviewRecord.assessment,
        preferences: personalTagPreferences()
      })
    };
  });
  ipcMain.handle("explore:record-dislike", async (event, value: unknown) => {
    const contents = exploreView?.webContents;
    if (!contents || contents.isDestroyed() || event.sender.id !== contents.id) return { success: false };
    if (!database || !vision?.available) throw new Error("本地视觉模型尚未就绪");
    if (!value || typeof value !== "object") throw new Error("Invalid payload");
    const { normalizedUrl: rawUrl, selectedLabels: rawSelectedLabels } = value as {
      normalizedUrl?: unknown;
      selectedLabels?: unknown;
    };
    if (typeof rawUrl !== "string" || !Array.isArray(rawSelectedLabels) || rawSelectedLabels.length > 5) {
      throw new Error("Invalid dislike payload");
    }
    if (!rawSelectedLabels.every((label) => typeof label === "string")) {
      throw new Error("Invalid dislike labels");
    }
    const normalizedUrl = normalizePixivArtworkImageUrl(rawUrl);
    if (!normalizedUrl) throw new Error("无法识别这张 Pixiv 图片");
    const pageKey = pixivArtworkPageKey(normalizedUrl);
    if (!pageKey) throw new Error("无法识别作品页");
    const reviewRecord = database.getLatestRemoteImageReview(normalizedUrl);
    if (
      !reviewRecord || reviewRecord.assessment.status !== "complete" ||
      reviewRecord.engine !== vision.engine || reviewRecord.engineVersion !== vision.engineVersion
    ) {
      throw new Error("这张图片尚未完成本地分析，请稍后再试");
    }

    const currentPreferences = personalTagPreferences();
    const candidates = selectDislikeTagCandidates({
      assessment: reviewRecord.assessment,
      preferences: currentPreferences
    });
    const allowedLabels = new Set(candidates.map((candidate) => candidate.label));
    const selectedLabels = [...new Set(rawSelectedLabels)];
    if (!selectedLabels.every((label) => allowedLabels.has(label))) {
      throw new Error("选择中包含未经本地模型确认的标签");
    }
    const allowExceptions = explorePageExceptions();
    const feedback = createDislikeFeedback({
      id: randomUUID(),
      normalizedUrl,
      assessment: reviewRecord.assessment,
      selectedLabels,
      personalPreferences: currentPreferences,
      hadAllowException: allowExceptions.includes(pageKey)
    });
    if (!feedback) throw new Error("无法记录这次偏好");

    database.setPreference(
      personalTagPreferencesKey(),
      applyPersonalPreferenceChanges(currentPreferences, feedback.personalChanges)
    );
    database.setPreference(
      DISLIKE_PAGE_EXCEPTIONS_PREFERENCE,
      [...new Set([...exploreDislikePageExceptions(), pageKey])].slice(-2_000)
    );
    database.setPreference(
      PAGE_EXCEPTIONS_PREFERENCE,
      allowExceptions.filter((entry) => entry !== pageKey)
    );
    database.setPreference(
      ADAPTIVE_FEEDBACK_PREFERENCE,
      [...adaptiveFeedbackHistory(), feedback].slice(-500)
    );
    remoteReviewCache.clear();
    contents.send("explore:review-result", {
      normalizedUrl,
      state: "blocked",
      reasons: [selectedLabels.length > 0 ? "个人偏好：少看类似元素" : "个人偏好：仅隐藏这张"]
    });
    return {
      success: true,
      feedbackId: feedback.id,
      pageKey,
      selectedTags: feedback.selectedTags.map((tag) => ({
        label: tag.label,
        confidence: Math.round(tag.confidence * 100)
      })),
      changes: feedback.personalChanges.map((change) => ({
        label: change.label,
        oldWeight: Math.round((change.oldPreference?.weight ?? 0) * 100),
        newWeight: Math.round((change.newPreference?.weight ?? 0) * 100),
        oldEvidence: change.oldPreference?.evidenceCount ?? 0,
        newEvidence: change.newPreference?.evidenceCount ?? 0
      }))
    };
  });
  ipcMain.handle("explore:mark-false-positive", async (event, value: unknown) => {
    const contents = exploreView?.webContents;
    if (!contents || contents.isDestroyed() || event.sender.id !== contents.id) return { success: false };
    if (!database) throw new Error("Database is not ready");
    if (!value || typeof value !== "object") throw new Error("Invalid payload");
    const rawUrl = (value as { normalizedUrl?: string }).normalizedUrl;
    if (typeof rawUrl !== "string") throw new Error("Missing normalizedUrl");
    const normalizedUrl = normalizePixivArtworkImageUrl(rawUrl);
    if (!normalizedUrl) throw new Error("无法识别这张 Pixiv 图片");
    const pageKey = pixivArtworkPageKey(normalizedUrl);
    if (!pageKey) throw new Error("Unable to identify the Pixiv artwork page");

    const exceptions = explorePageExceptions();
    const dislikeExceptions = exploreDislikePageExceptions();
    if (!exceptions.includes(pageKey)) {
      database.setPreference(PAGE_EXCEPTIONS_PREFERENCE, [...exceptions, pageKey].slice(-2_000));
    }
    if (dislikeExceptions.includes(pageKey)) {
      database.setPreference(
        DISLIKE_PAGE_EXCEPTIONS_PREFERENCE,
        dislikeExceptions.filter((entry) => entry !== pageKey)
      );
    }

    const reviewRecord = database.getLatestRemoteImageReview(normalizedUrl);
    const currentOverrides = adaptiveThresholdOverrides();
    const currentPersonalPreferences = personalTagPreferences();
    const feedback = reviewRecord && vision &&
      reviewRecord.engine === vision.engine && reviewRecord.engineVersion === vision.engineVersion
      ? createFalsePositiveFeedback({
          id: randomUUID(),
          normalizedUrl,
          assessment: reviewRecord.assessment,
          reasons: reviewRecord.decision.reasons,
          thresholdOverrides: currentOverrides,
          personalPreferences: currentPersonalPreferences,
          hadAllowException: exceptions.includes(pageKey),
          hadDislikeException: dislikeExceptions.includes(pageKey)
        })
      : null;

    if (feedback) {
      if (feedback.changes.length > 0) {
        database.setPreference(
          thresholdOverridesPreferenceKey(feedback.engine, feedback.engineVersion),
          applyFeedbackChanges(currentOverrides, feedback)
        );
      }
      if (feedback.personalChanges.length > 0) {
        database.setPreference(
          personalTagPreferencesKey(feedback.engine, feedback.engineVersion),
          applyPersonalPreferenceChanges(currentPersonalPreferences, feedback.personalChanges)
        );
      }
      database.setPreference(
        ADAPTIVE_FEEDBACK_PREFERENCE,
        [...adaptiveFeedbackHistory(), feedback].slice(-500)
      );
    }

    remoteReviewCache.clear();
    remoteOneShotAllows.add(normalizedUrl);

    contents.send("explore:review-result", {
      normalizedUrl,
      state: "allowed",
      reasons: []
    });

    return {
      success: true,
      feedbackId: feedback?.id ?? null,
      pageKey,
      changes: feedback?.changes.map((change) => ({
        label: change.label,
        confidence: Math.round(change.confidence * 100),
        oldThreshold: Math.round(change.oldThreshold * 100),
        newThreshold: Math.round(change.newThreshold * 100)
      })) ?? [],
      personalChanges: feedback?.personalChanges.map((change) => ({
        label: change.label,
        oldWeight: Math.round((change.oldPreference?.weight ?? 0) * 100),
        newWeight: Math.round((change.newPreference?.weight ?? 0) * 100),
        oldEvidence: change.oldPreference?.evidenceCount ?? 0,
        newEvidence: change.newPreference?.evidenceCount ?? 0
      })) ?? []
    };
  });
  ipcMain.handle("explore:undo-preference-feedback", async (event, value: unknown) => {
    const contents = exploreView?.webContents;
    if (!contents || contents.isDestroyed() || event.sender.id !== contents.id) return { success: false };
    if (!database) throw new Error("Database is not ready");
    const feedbackId = value && typeof value === "object"
      ? (value as { feedbackId?: unknown }).feedbackId
      : undefined;
    if (typeof feedbackId !== "string") throw new Error("Missing feedbackId");

    const history = adaptiveFeedbackHistory();
    const feedback = history.at(-1);
    if (!feedback || feedback.id !== feedbackId) {
      throw new Error("只能撤销最近一次偏好调整");
    }
    const remainingHistory = history.slice(0, -1);
    if (feedback.kind === "false-positive") {
      database.setPreference(
        thresholdOverridesPreferenceKey(feedback.engine, feedback.engineVersion),
        undoFeedbackChanges(
          adaptiveThresholdOverrides(feedback.engine, feedback.engineVersion),
          feedback
        )
      );
      database.setPreference(
        personalTagPreferencesKey(feedback.engine, feedback.engineVersion),
        undoPersonalPreferenceChanges(
          personalTagPreferences(feedback.engine, feedback.engineVersion),
          feedback.personalChanges
        )
      );
    } else {
      database.setPreference(
        personalTagPreferencesKey(feedback.engine, feedback.engineVersion),
        undoPersonalPreferenceChanges(
          personalTagPreferences(feedback.engine, feedback.engineVersion),
          feedback.personalChanges
        )
      );
    }
    database.setPreference(ADAPTIVE_FEEDBACK_PREFERENCE, remainingHistory);
    if (feedback.kind === "false-positive") {
      database.setPreference(
        PAGE_EXCEPTIONS_PREFERENCE,
        feedback.hadAllowException
          ? [...new Set([...explorePageExceptions(), feedback.pageKey])]
          : explorePageExceptions().filter((pageKey) => pageKey !== feedback.pageKey)
      );
      database.setPreference(
        DISLIKE_PAGE_EXCEPTIONS_PREFERENCE,
        feedback.hadDislikeException
          ? [...new Set([...exploreDislikePageExceptions(), feedback.pageKey])]
          : exploreDislikePageExceptions().filter((pageKey) => pageKey !== feedback.pageKey)
      );
    } else {
      database.setPreference(
        DISLIKE_PAGE_EXCEPTIONS_PREFERENCE,
        exploreDislikePageExceptions().filter((pageKey) => pageKey !== feedback.pageKey)
      );
      database.setPreference(
        PAGE_EXCEPTIONS_PREFERENCE,
        feedback.hadAllowException
          ? [...new Set([...explorePageExceptions(), feedback.pageKey])]
          : explorePageExceptions().filter((pageKey) => pageKey !== feedback.pageKey)
      );
    }
    remoteReviewCache.clear();
    // Persistent reviews are keyed by the complete rules fingerprint. Undo restores the
    // previous fingerprint, so its matching reviews remain valid and should be reused.
    return { success: true };
  });
  ipcMain.on("explore:inspect-url", (event, value: unknown) => {
    const contents = exploreView?.webContents;
    if (!contents || contents.isDestroyed() || event.sender.id !== contents.id) return;
    if (!value || typeof value !== "object") return;
    const rawUrl = (value as { url?: string }).url;
    if (typeof rawUrl === "string" && isPixivArtworkImageUrl(rawUrl)) {
      const normalizedUrl = normalizePixivArtworkImageUrl(rawUrl) || rawUrl;
      const artworkIdMatch = normalizedUrl.match(/\/(\d+)_(?:p\d+|_|\.)/);
      const artworkId = artworkIdMatch && artworkIdMatch[1] ? artworkIdMatch[1] : undefined;
      const pageMatch = normalizedUrl.match(/_p(\d+)(?:_|\.)/);
      const pageIndex = pageMatch && pageMatch[1] ? parseInt(pageMatch[1], 10) : undefined;
      mainWindow?.webContents.send("explore:open-inspector", {
        artworkId,
        url: normalizedUrl,
        pageIndex
      });
    }
  });

  ipcMain.handle("collections:create", (_event, value: unknown) => {
    const draft = parseCollectionDraft(value);
    if (!database || !draft) throw new Error("Invalid collection");
    database.createCollection(draft.name, draft.description);
    return database.listCollections();
  });
  ipcMain.handle("collections:update", (_event, collectionId: unknown, value: unknown) => {
    const draft = parseCollectionDraft(value);
    if (!database || typeof collectionId !== "string" || !draft) {
      throw new Error("Invalid collection update");
    }
    database.updateCollection(collectionId, draft.name, draft.description);
    return database.listCollections();
  });
  ipcMain.handle("collections:delete", (_event, collectionId: unknown) => {
    if (!database || typeof collectionId !== "string") throw new Error("Invalid collection id");
    database.deleteCollection(collectionId);
    return database.listCollections();
  });

  ipcMain.handle("collections:update-cover", (_event, collectionId: unknown, artworkId: unknown) => {
    if (!database || typeof collectionId !== "string" || (artworkId !== null && typeof artworkId !== "string")) {
      throw new Error("Invalid collection cover assignment");
    }
    if (!database.listCollections().some((collection) => collection.id === collectionId)) {
      throw new Error("Collection does not exist");
    }
    if (artworkId !== null) {
      const artwork = database.listArtworks().find((candidate) => candidate.id === artworkId);
      if (!artwork?.collectionIds.includes(collectionId)) {
        throw new Error("Collection cover must belong to the selected collection");
      }
    }
    database.updateCollectionCover(collectionId, artworkId);
    return database.listCollections();
  });

  ipcMain.handle(
    "collections:add-artwork",
    (_event, artworkId: unknown, collectionId: unknown) => {
      if (!database || typeof artworkId !== "string" || typeof collectionId !== "string") {
        throw new Error("Invalid collection assignment");
      }
      database.addArtworkToCollection(artworkId, collectionId);
      return database.listArtworks();
    }
  );
  ipcMain.handle(
    "collections:add-work",
    (_event, workIdValue: unknown, collectionId: unknown) => {
      const workId = parseWorkId(workIdValue);
      if (!database || !workId || typeof collectionId !== "string") {
        throw new Error("Invalid work collection assignment");
      }
      if (!database.getWork(workId)) throw new Error("Work does not exist");
      if (!database.listCollections().some((collection) => collection.id === collectionId)) {
        throw new Error("Collection does not exist");
      }
      database.addWorkToCollection(workId, collectionId);
      return database.getWork(workId);
    }
  );
  ipcMain.handle(
    "collections:remove-work",
    (_event, workIdValue: unknown, collectionId: unknown) => {
      const workId = parseWorkId(workIdValue);
      if (!database || !workId || typeof collectionId !== "string") {
        throw new Error("Invalid work collection removal");
      }
      database.removeWorkFromCollection(workId, collectionId);
      return database.getWork(workId);
    }
  );
  ipcMain.handle("library:update-favorite", (_event, values: unknown, favorite: unknown) => {
    const workIds = parseWorkIds(values);
    if (!database || !workIds || typeof favorite !== "boolean") {
      throw new Error("Invalid favorite update");
    }
    database.updateWorkFavorite(workIds, favorite);
    return true;
  });
  ipcMain.handle("preferences:appearance:get", (): AppearancePreferences =>
    database?.getPreference<AppearancePreferences>("appearance") ?? {
      displayProfile: "balanced",
      reducedMotion: false,
      ambientArtwork: true
    }
  );
  ipcMain.handle("preferences:appearance:update", (_event, value: unknown): AppearancePreferences => {
    const preferences = parseAppearancePreferences(value);
    if (!database || !preferences) throw new Error("Invalid appearance preferences");
    database.setPreference("appearance", preferences);
    return preferences;
  });
  ipcMain.handle("preferences:library:get", (): LibraryPreferences => libraryPreferences());
  ipcMain.handle("preferences:library:update", (_event, value: unknown): LibraryPreferences => {
    if (!database || !isLibraryPreferences(value)) throw new Error("Invalid library preferences");
    database.setPreference("library.preferences", value);
    return value;
  });
  ipcMain.handle("preferences:library:choose-download-directory", async (): Promise<LibraryPreferences> => {
    if (!database || !mainWindow) throw new Error("Application window is unavailable");
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: "选择 Pixiv 作品保存目录",
      properties: ["openDirectory", "createDirectory"]
    });
    if (selected.canceled || !selected.filePaths[0]) return libraryPreferences();
    const next = { ...libraryPreferences(), downloadDirectory: resolve(selected.filePaths[0]) };
    database.setPreference("library.preferences", next);
    return next;
  });

  ipcMain.handle("app:status", () => currentApplicationStatus());
}

function currentApplicationStatus() {
  return {
    visionEngine: vision?.engine ?? "unavailable",
    visionProvider: vision?.executionProvider ?? "unknown",
    visionReady: vision?.available ?? false,
    visionState: vision?.state ?? "failed",
    visionError: vision?.error ?? "Vision runtime is unavailable",
    modelBacked: vision?.engine === "wd-swinv2-tagger-v3"
  } as const;
}

async function encodeLocalThumbnail(sourcePath: string, targetPath: string): Promise<void> {
  await new Promise<void>((resolveTask) => setImmediate(resolveTask));
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error(`Unable to decode image: ${sourcePath}`);
  const size = image.getSize();
  const longestEdge = Math.max(size.width, size.height);
  const scale = longestEdge > 640 ? 640 / longestEdge : 1;
  const resized = scale < 1
    ? image.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: "better"
      })
    : image;
  const bytes = resized.toPNG();
  if (bytes.length === 0) throw new Error(`Unable to encode thumbnail: ${sourcePath}`);
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, targetPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function canShowExploreContent(): boolean {
  return exploreProtectionBypassed || Boolean(vision?.available);
}

function syncExploreProtectionVisibility(): void {
  if (!exploreVisible || !canShowExploreContent()) {
    exploreView?.setVisible(false);
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed() || !exploreBounds) return;
  const view = ensureExploreView();
  view.setBounds(exploreBounds);
  view.setVisible(true);
  sendExploreProtectionMode();
  if (!view.webContents.getURL()) void view.webContents.loadURL(PIXIV_HOME_URL);
}

function sendExploreProtectionMode(): void {
  const contents = exploreView?.webContents;
  if (!contents || contents.isDestroyed()) return;
  contents.send("explore:protection-mode", {
    enabled: !exploreProtectionBypassed && Boolean(vision?.available)
  });
}

function ensureExploreView(): WebContentsView {
  if (exploreView && !exploreView.webContents.isDestroyed()) return exploreView;
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("Application window is unavailable");

  const view = new WebContentsView({
    webPreferences: {
      partition: PIXIV_SESSION_PARTITION,
      ...(ENABLE_VIEWPORT_REVIEW
        ? { preload: join(moduleDirectory, "../preload/explore.cjs") }
        : {}),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  });
  exploreView = view;
  mainWindow.contentView.addChildView(view);
  view.setVisible(false);
  if (exploreBounds) view.setBounds(exploreBounds);

  const contents = view.webContents;
  const exploreSession = contents.session;
  exploreSession.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin, details) =>
      shouldAllowPixivLoginPermission(
        permission,
        details.requestingUrl ?? requestingOrigin,
        contents.getURL()
      )
  );
  exploreSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const requestingUrl = "requestingUrl" in details ? details.requestingUrl : "";
    callback(
      shouldAllowPixivLoginPermission(
        permission,
        requestingUrl,
        contents.getURL()
      )
    );
  });
  exploreSession.on("will-download", (event) => event.preventDefault());
  exploreSession.webRequest.onBeforeRequest(
    { urls: ["*://*/*"] },
    (details, callback) => {
      if (details.resourceType === "image" && isPixivArtworkImageUrl(details.url)) {
        if (exploreProtectionBypassed) {
          callback({ cancel: false });
          return;
        }
        const normalizedUrl = normalizePixivArtworkImageUrl(details.url);
        if (remoteOneShotAllows.delete(details.url) || (normalizedUrl && remoteOneShotAllows.delete(normalizedUrl))) {
          callback({ cancel: false });
          return;
        }
        if (!normalizedUrl) {
          callback({ cancel: true });
          return;
        }
        if (!ENABLE_VIEWPORT_REVIEW) {
          void reviewRemoteArtwork(details.url, details.referrer)
            .then(async (outcome) => {
              if (outcome.state === "blocked") {
                await contents.executeJavaScript(
                  buildPixivBlockedReviewScript(normalizedUrl, outcome.reasons),
                  true
                ).catch((error: unknown) => {
                  console.error("[pixiv-placeholder] failed to install", error);
                });
              }
              callback({ cancel: outcome.state !== "allowed" });
            })
            .catch(() => callback({ cancel: true }));
          return;
        }
        const cached = findCachedRemoteReview(normalizedUrl);
        callback({ cancel: cached ? cached.state === "blocked" : false });
        if (cached) void publishRemoteReviewOutcome(contents, normalizedUrl, cached);
        return;
      }
      const blocked = shouldBlockExploreResource(
        details.resourceType,
        details.url,
        contents.getURL()
      );
      if (blocked) {
        if (shouldBlockExploreAdRequest(
          details.resourceType,
          details.url,
          contents.getURL()
        )) {
          exploreBlockedAds += 1;
        } else {
          exploreBlockedResources += 1;
        }
        scheduleExploreState();
      }
      callback({ cancel: blocked });
    }
  );

  contents.setWindowOpenHandler((details) => {
    if (isAllowedPixivNavigation(details.url)) void contents.loadURL(details.url);
    else {
      exploreError = "已阻止跳转到 Pixiv 之外的网站";
      scheduleExploreState();
    }
    return { action: "deny" };
  });
  contents.on("console-message", (_event, _level, message) => {
    const downloadPrefix = `sanctuary-download:${pixivRevealToken}:`;
    if (message.startsWith(downloadPrefix)) {
      const artworkId = message.slice(downloadPrefix.length);
      const context = parsePixivPageContext(contents.getURL());
      if (!/^\d+$/.test(artworkId) || context.kind !== "artwork" || context.artworkId !== artworkId) {
        updateExploreDownloadState({
          phase: "error",
          scope: "current",
          message: "网页下载请求与当前作品页不匹配，已拒绝"
        });
        return;
      }
      void downloadCurrentPixivArtwork().catch(() => undefined);
      return;
    }
    const inspectPrefix = `sanctuary-inspect:${pixivRevealToken}:`;
    if (message.startsWith(inspectPrefix)) {
      const rest = message.slice(inspectPrefix.length);
      const colonIdx = rest.indexOf(":");
      let rawArtworkId = "";
      let decodedUrl: string | undefined = undefined;
      if (colonIdx !== -1) {
        rawArtworkId = rest.slice(0, colonIdx);
        try {
          const u = decodeURIComponent(rest.slice(colonIdx + 1));
          if (isPixivArtworkImageUrl(u)) decodedUrl = u;
        } catch {}
      } else {
        rawArtworkId = rest;
      }
      const artworkId = rawArtworkId.trim();
      const payload: { artworkId?: string; url?: string } = {};
      if (/^\d+$/.test(artworkId)) payload.artworkId = artworkId;
      if (decodedUrl) payload.url = decodedUrl;
      mainWindow?.webContents.send("explore:open-inspector", payload);
      return;
    }
    const inspectUrlPrefix = `sanctuary-inspect-url:${pixivRevealToken}:`;
    if (message.startsWith(inspectUrlPrefix)) {
      try {
        const decodedUrl = decodeURIComponent(message.slice(inspectUrlPrefix.length));
        if (isPixivArtworkImageUrl(decodedUrl)) {
          mainWindow?.webContents.send("explore:open-inspector", { url: decodedUrl });
        }
      } catch {}
      return;
    }
    const prefix = `sanctuary-reveal:${pixivRevealToken}:`;
    if (!message.startsWith(prefix)) return;
    let normalizedUrl: string | null = null;
    try {
      normalizedUrl = normalizePixivArtworkImageUrl(
        decodeURIComponent(message.slice(prefix.length))
      );
    } catch {
      normalizedUrl = null;
    }
    if (!normalizedUrl) return;
    remoteOneShotAllows.add(normalizedUrl);
    contents.send("explore:review-result", {
      normalizedUrl,
      state: "allowed",
      reasons: []
    });
    void contents.executeJavaScript(buildPixivReviewReleaseScript(normalizedUrl), true)
      .catch((error: unknown) => {
        console.error("[pixiv-reveal] failed to release one-shot image", error);
      });
  });
  contents.on("will-navigate", (event) => {
    if (!event.isMainFrame) {
      if (!isAllowedPixivNavigation(event.url)) event.preventDefault();
      return;
    }
    if (isAllowedPixivNavigation(event.url)) return;
    event.preventDefault();
    exploreError = "已阻止跳转到 Pixiv 之外的网站";
    scheduleExploreState();
  });
  contents.on("will-redirect", (event) => {
    if (!event.isMainFrame) {
      if (!isAllowedPixivNavigation(event.url)) event.preventDefault();
      return;
    }
    if (isAllowedPixivNavigation(event.url)) return;
    event.preventDefault();
    exploreError = "已阻止 Pixiv 将页面重定向到站外";
    scheduleExploreState();
  });
  contents.on("did-start-loading", () => {
    exploreError = "";
    resetExploreReviewQueue();
    scheduleExploreState();
  });
  contents.on("dom-ready", () => {
    sendExploreProtectionMode();
    void installPixivDomAdapter(contents);
  });
  contents.on("did-stop-loading", () => {
    void installPixivDomAdapter(contents);
    scheduleExploreState();
  });
  contents.on("did-navigate", () => {
    resetExploreReviewQueue();
    void installPixivDomAdapter(contents);
    scheduleExploreState();
  });
  contents.on("did-navigate-in-page", () => {
    resetExploreReviewQueue();
    void installPixivDomAdapter(contents);
    scheduleExploreState();
  });
  contents.on("page-title-updated", scheduleExploreState);
  contents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      exploreError = `页面加载失败：${errorDescription}`;
      scheduleExploreState();
    }
  );

  return view;
}

function currentExploreState(): ExploreState {
  const contents = exploreView?.webContents;
  const pageContext = parsePixivPageContext(contents?.getURL() ?? PIXIV_HOME_URL);
  const protectionStatus = exploreProtectionBypassed ? "bypassed" : (vision?.state ?? "failed");
  const protectionError = exploreProtectionBypassed ? "" : (vision?.error ?? "视觉模型不可用");
  if (!contents || contents.isDestroyed()) {
    return {
      url: PIXIV_HOME_URL,
      title: "Pixiv 探索",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      blockedResources: exploreBlockedResources,
      blockedAds: exploreBlockedAds,
      approvedResources: exploreApprovedResources,
      pendingResources: explorePendingResources,
      queuedResources: exploreReviewQueue.size,
      remoteReviewCacheHits: exploreRemoteReviewCacheHits,
      remoteReviewCacheMisses: exploreRemoteReviewCacheMisses,
      error: exploreError,
      protectionStatus,
      protectionError,
      maximized: mainWindow?.isMaximized() ?? false,
      pageKind: pageContext.kind,
      artworkId: pageContext.artworkId,
      bookmarkUserId: pageContext.bookmarkUserId,
      download: { ...exploreDownloadState }
    };
  }
  return {
    url: contents.getURL() || PIXIV_HOME_URL,
    title: contents.getTitle() || "Pixiv 探索",
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    blockedResources: exploreBlockedResources,
    blockedAds: exploreBlockedAds,
    approvedResources: exploreApprovedResources,
    pendingResources: explorePendingResources,
    queuedResources: exploreReviewQueue.size,
    remoteReviewCacheHits: exploreRemoteReviewCacheHits,
    remoteReviewCacheMisses: exploreRemoteReviewCacheMisses,
    error: exploreError,
    protectionStatus,
    protectionError,
    maximized: mainWindow?.isMaximized() ?? false,
    pageKind: pageContext.kind,
    artworkId: pageContext.artworkId,
    bookmarkUserId: pageContext.bookmarkUserId,
    download: { ...exploreDownloadState }
  };
}

function updateExploreDownloadState(
  patch: Partial<ExploreDownloadState>
): void {
  exploreDownloadState = { ...exploreDownloadState, ...patch };
  scheduleExploreState();
}

function downloadCurrentPixivArtwork(): Promise<ExploreDownloadResult> {
  const context = parsePixivPageContext(exploreView?.webContents.getURL() ?? "");
  if (context.kind !== "artwork") {
    throw new Error("请先打开一个 Pixiv 作品详情页");
  }
  
  return startExploreDownload("current", async () => {
    updateExploreDownloadState({
      phase: "discovering",
      totalArtworks: 1,
      message: `正在读取作品 ${context.artworkId}…`
    });
    const result = await downloadPixivArtwork(context.artworkId, true, true);
    updateExploreDownloadState({ completedArtworks: 1 });
    return {
      completedArtworks: 1,
      failedArtworks: 0,
      downloadedPages: result.downloadedPages,
      skippedPages: result.skippedPages,
      lastFailure: "",
      destination: pixivGalleryDirectory()
    };
  });
}

function startExploreDownload(
  scope: Exclude<ExploreDownloadState["scope"], null>,
  task: () => Promise<ExploreDownloadResult>
): Promise<ExploreDownloadResult> {
  if (activeExploreDownload) {
    throw new Error("已有下载任务正在运行，请等待它完成");
  }
  if (activeArtistAvatarRepair) {
    throw new Error("作者头像正在补全，请等待完成后再下载作品");
  }
  exploreDownloadState = {
    ...IDLE_EXPLORE_DOWNLOAD_STATE,
    phase: "discovering",
    scope,
    message: scope === "current" ? "正在读取当前作品…" : "正在读取收藏列表…"
  };
  scheduleExploreState();

  const running = task()
    .then((result) => {
      updateExploreDownloadState({
        phase: completedDownloadPhase(result.completedArtworks, result.failedArtworks),
        completedArtworks: result.completedArtworks,
        failedArtworks: result.failedArtworks,
        lastFailure: result.lastFailure,
        message: result.failedArtworks > 0
          ? `已保存 ${result.completedArtworks} 个作品，${result.failedArtworks} 个失败。${result.lastFailure ? `最后失败：${result.lastFailure}` : ""}`
          : `已保存 ${result.completedArtworks} 个作品到本地画廊`
      });
      return result;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "下载失败";
      updateExploreDownloadState({ phase: "error", message, lastFailure: message });
      throw error;
    })
    .finally(() => {
      activeExploreDownload = undefined;
    });
  activeExploreDownload = running;
  return running;
}

function requireExploreSession(): Session {
  const contents = exploreView?.webContents;
  if (!contents || contents.isDestroyed()) {
    throw new Error("Pixiv 探索会话尚未准备好");
  }
  return contents.session;
}

function pixivGalleryDirectory(): string {
  return libraryPreferences().downloadDirectory ?? join(app.getPath("pictures"), "Digital Sanctuary", "Pixiv");
}

function repairMissingArtistAvatars(): Promise<ArtistAvatarRepairResult> {
  if (!database) throw new Error("本地画廊尚未准备好");
  if (activeExploreDownload) {
    throw new Error("作品下载任务正在运行，请等待完成后再补全作者头像");
  }
  if (activeArtistAvatarRepair) return activeArtistAvatarRepair;

  const running = runArtistAvatarRepair().finally(() => {
    activeArtistAvatarRepair = undefined;
  });
  activeArtistAvatarRepair = running;
  return running;
}

async function runArtistAvatarRepair(): Promise<ArtistAvatarRepairResult> {
  if (!database) throw new Error("本地画廊尚未准备好");
  const artists = database.listArtists();
  const targetSession = ensureExploreView().webContents.session;
  const result: ArtistAvatarRepairResult = {
    totalArtists: artists.length,
    repairedArtists: 0,
    alreadyPresentArtists: 0,
    unavailableArtists: 0,
    failedArtists: 0,
    lastFailure: ""
  };

  for (let index = 0; index < artists.length; index += 1) {
    const artist = artists[index]!;
    if (hasUsableArtistAvatar(artist)) {
      result.alreadyPresentArtists += 1;
      continue;
    }
    try {
      const repaired = await fetchAndStorePixivArtist(targetSession, artist.id, artist.name);
      if (repaired.avatarLocalPath) result.repairedArtists += 1;
      else result.unavailableArtists += 1;
    } catch (error) {
      result.failedArtists += 1;
      result.lastFailure = `${artist.name}（${artist.id}）：${errorMessage(error)}`;
      console.warn(`[pixiv-avatar-repair] ${result.lastFailure}`, error);
      if (error instanceof PixivBatchAbortError) {
        result.failedArtists += artists
          .slice(index + 1)
          .filter((remaining) => !hasUsableArtistAvatar(remaining)).length;
        break;
      }
    }
  }
  return result;
}

async function fetchPixivBookmarkTotal(
  targetSession: Session,
  userId: string
): Promise<number> {
  const visible = await fetchPixivBookmarkPage(targetSession, userId, "show", 0);
  let hiddenTotal = 0;
  try {
    hiddenTotal = (await fetchPixivBookmarkPage(targetSession, userId, "hide", 0)).total;
  } catch (error) {
    console.info("[pixiv-download] private bookmarks are unavailable", error);
  }
  return visible.total + hiddenTotal;
}

async function fetchAllPixivBookmarkIds(
  targetSession: Session,
  userId: string
): Promise<string[]> {
  const allIds = new Set<string>();
  for (const visibility of ["show", "hide"] as const) {
    try {
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;
      while (offset < total) {
        const page = await fetchPixivBookmarkPage(
          targetSession,
          userId,
          visibility,
          offset
        );
        total = page.total;
        for (const artworkId of page.artworkIds) allIds.add(artworkId);
        updateExploreDownloadState({
          totalArtworks: allIds.size,
          message: `已读取 ${allIds.size} 个收藏作品…`
        });
        if (page.artworkIds.length === 0) break;
        offset += PIXIV_BOOKMARK_PAGE_SIZE;
      }
    } catch (error) {
      if (visibility === "show") throw error;
      console.info("[pixiv-download] private bookmarks are unavailable", error);
    }
  }
  return [...allIds];
}

async function fetchPixivBookmarkPage(
  targetSession: Session,
  userId: string,
  visibility: "show" | "hide",
  offset: number
) {
  const endpoint = new URL(
    `/ajax/user/${encodeURIComponent(userId)}/illusts/bookmarks`,
    PIXIV_HOME_URL
  );
  endpoint.searchParams.set("tag", "");
  endpoint.searchParams.set("offset", String(offset));
  endpoint.searchParams.set("limit", String(PIXIV_BOOKMARK_PAGE_SIZE));
  endpoint.searchParams.set("rest", visibility);
  endpoint.searchParams.set("lang", "zh");
  return parsePixivBookmarkPage(
    await fetchPixivJson(targetSession, endpoint.toString(), `${PIXIV_HOME_URL}users/${userId}/bookmarks/artworks`)
  );
}

async function fetchPixivArtworkPages(
  targetSession: Session,
  artworkId: string
): Promise<PixivArtworkPage[]> {
  const endpoint = new URL(`/ajax/illust/${encodeURIComponent(artworkId)}/pages`, PIXIV_HOME_URL);
  endpoint.searchParams.set("lang", "zh");
  return parsePixivArtworkPages(
    await fetchPixivJson(targetSession, endpoint.toString(), `${PIXIV_HOME_URL}artworks/${artworkId}`)
  );
}

async function fetchPixivArtworkMetadata(
  targetSession: Session,
  artworkId: string
): Promise<PixivArtworkMetadata> {
  const endpoint = new URL(`/ajax/illust/${encodeURIComponent(artworkId)}`, PIXIV_HOME_URL);
  endpoint.searchParams.set("lang", "zh");
  return parsePixivArtworkMetadata(
    await fetchPixivJson(
      targetSession,
      endpoint.toString(),
      `${PIXIV_HOME_URL}artworks/${artworkId}`
    ),
    artworkId
  );
}

async function fetchPixivArtistProfile(
  targetSession: Session,
  authorId: string
) {
  const endpoint = new URL(`/ajax/user/${encodeURIComponent(authorId)}`, PIXIV_HOME_URL);
  endpoint.searchParams.set("full", "1");
  endpoint.searchParams.set("lang", "zh");
  return parsePixivArtistProfile(
    await fetchPixivJson(
      targetSession,
      endpoint.toString(),
      `${PIXIV_HOME_URL}users/${authorId}`
    ),
    authorId
  );
}

let nextPixivApiCall = 0;
const PIXIV_API_DELAY_MS = 800;
const PIXIV_API_MAX_RETRIES = 2;

class PixivBatchAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PixivBatchAbortError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPixivApiSlot(): Promise<void> {
  const now = Date.now();
  const waitTime = Math.max(0, nextPixivApiCall - now);
  nextPixivApiCall = now + waitTime + PIXIV_API_DELAY_MS;
  if (waitTime > 0) await delay(waitTime);
}

function pixivRetryDelay(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after")?.trim() ?? "";
  const seconds = Number(retryAfter);
  const headerDelay = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1_000
    : 0;
  const fallback = attempt === 0 ? 5_000 : 15_000;
  return Math.min(30_000, Math.max(headerDelay, fallback));
}

async function fetchPixivJson(
  targetSession: Session,
  url: string,
  referrer: string
): Promise<unknown> {
  let attempt = 0;
  while (true) {
    await waitForPixivApiSlot();
    let response: Response;
    try {
      response = await pixivDownloadNetworkGate.run(() => targetSession.fetch(url, {
        credentials: "include",
        referrer,
        headers: {
          Accept: "application/json",
          Referer: referrer
        },
        bypassCustomProtocolHandlers: true
      }));
    } catch (networkError) {
      if (attempt >= PIXIV_API_MAX_RETRIES) {
        throw new PixivBatchAbortError(
          `Pixiv 网络连续失败，批量任务已停止：${errorMessage(networkError)}`
        );
      }
      const backoffMs = pixivRetryDelay(null, attempt);
      attempt += 1;
      updateExploreDownloadState({
        message: `网络异常，${Math.ceil(backoffMs / 1_000)} 秒后重试 (${attempt}/${PIXIV_API_MAX_RETRIES})…`
      });
      await delay(backoffMs);
      continue;
    }

    if (response.status === 429) {
      if (attempt >= PIXIV_API_MAX_RETRIES) {
        throw new PixivBatchAbortError(
          "Pixiv 已限制请求频率，批量任务已停止。请稍后从收藏页重新开始，已保存作品会自动跳过。"
        );
      }
      const backoffMs = pixivRetryDelay(response, attempt);
      attempt += 1;
      updateExploreDownloadState({
        message: `Pixiv 频率限制，${Math.ceil(backoffMs / 1_000)} 秒后重试 (${attempt}/${PIXIV_API_MAX_RETRIES})…`
      });
      await delay(backoffMs);
      continue;
    }

    if (response.status === 401) {
      throw new PixivBatchAbortError("Pixiv 登录会话已失效，请重新登录后再继续下载");
    }
    if (response.status === 403) {
      throw new Error("作品不可访问、已删除或当前账号无权读取 (HTTP 403)");
    }
    if (response.status >= 500 && response.status <= 599) {
      if (attempt >= PIXIV_API_MAX_RETRIES) {
        throw new PixivBatchAbortError(`Pixiv 服务连续返回 HTTP ${response.status}，批量任务已停止`);
      }
      const backoffMs = pixivRetryDelay(response, attempt);
      attempt += 1;
      updateExploreDownloadState({
        message: `Pixiv 服务暂时异常，${Math.ceil(backoffMs / 1_000)} 秒后重试 (${attempt}/${PIXIV_API_MAX_RETRIES})…`
      });
      await delay(backoffMs);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Pixiv 数据请求失败：HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error("Pixiv 返回的不是有效 JSON 数据");
    }
  }
}

function hasUsableArtistAvatar(artist: ArtistRecord | undefined): boolean {
  return !!artist?.avatarLocalPath && existsSync(artist.avatarLocalPath);
}

async function fetchAndStorePixivArtist(
  targetSession: Session,
  authorId: string,
  fallbackName: string
): Promise<ArtistRecord> {
  if (!database) throw new Error("本地画廊尚未准备好");
  const profile = await fetchPixivArtistProfile(targetSession, authorId);
  let avatarLocalPath: string | null = null;
  if (profile.avatarUrl) {
    const extension = safePixivImageExtension(profile.avatarUrl);
    const avatarDirectory = join(pixivGalleryDirectory(), "..", "avatars");
    await mkdir(avatarDirectory, { recursive: true });
    const destination = join(avatarDirectory, `${authorId}${extension}`);
    if (!existsSync(destination)) {
      await downloadPixivOriginalImage(
        profile.avatarUrl,
        `${PIXIV_HOME_URL}users/${authorId}`,
        destination,
        "头像"
      );
    }
    avatarLocalPath = destination;
  }
  const artist: ArtistRecord = {
    id: authorId,
    name: profile.authorName || fallbackName,
    avatarUrl: profile.avatarUrl,
    avatarLocalPath,
    updatedAt: new Date().toISOString()
  };
  database.importArtist(artist);
  return artist;
}

async function downloadPixivArtwork(
  artworkId: string,
  resetPageTotal: boolean,
  trustAsUserDownload: boolean
): Promise<{ downloadedPages: number; skippedPages: number; fastPathed?: boolean }> {
  if (!database || !vision) throw new Error("本地画廊或视觉引擎尚未准备好");

  const localArtworks = database.listArtworks().filter((a) => a.source?.platform === "pixiv" && a.source?.workId === artworkId);
  const authorId = localArtworks[0]?.source?.authorId;
  const existingArtist = authorId
    ? database.listArtists().find((artist) => artist.id === authorId)
    : undefined;
  if (hasUsableArtistAvatar(existingArtist) && isCompleteIndexedPixivWork(localArtworks)) {
    for (const local of localArtworks) {
      if (trustAsUserDownload) database.trustArtwork(local.id);
    }
    return { downloadedPages: 0, skippedPages: localArtworks.length, fastPathed: true };
  }

  const targetSession = requireExploreSession();
  const metadata = await fetchPixivArtworkMetadata(targetSession, artworkId);
  const existingArtistBefore = database.listArtists().find((artist) => artist.id === metadata.authorId);
  if (existingArtistBefore && hasUsableArtistAvatar(existingArtistBefore)) {
    database.importArtist({
      ...existingArtistBefore,
      name: metadata.authorName,
      updatedAt: new Date().toISOString()
    });
  } else {
    try {
      await fetchAndStorePixivArtist(targetSession, metadata.authorId, metadata.authorName);
    } catch (error) {
      console.warn(`[pixiv-avatar] ${metadata.authorId}: ${errorMessage(error)}`);
      database.importArtist({
        id: metadata.authorId,
        name: metadata.authorName,
        avatarUrl: existingArtistBefore?.avatarUrl ?? metadata.authorAvatarUrl,
        avatarLocalPath: null,
        updatedAt: new Date().toISOString()
      });
    }
  }
  const pages = await fetchPixivArtworkPages(targetSession, artworkId);
  updateExploreDownloadState({
    phase: "downloading",
    totalPages: resetPageTotal
      ? pages.length
      : exploreDownloadState.totalPages + pages.length,
    message: `正在保存作品 ${artworkId}（共 ${pages.length} 页）`
  });

  const artworkDirectory = join(pixivGalleryDirectory(), artworkId);
  await mkdir(artworkDirectory, { recursive: true });
  let networkCompletedPages = 0;
  const localPages = await mapWithConcurrency(
    pages,
    PIXIV_DOWNLOAD_CONCURRENCY,
    async (page) => {
    const extension = safePixivImageExtension(page.originalUrl);
    const imagePath = join(artworkDirectory, `${artworkId}_p${page.index}${extension}`);
    const existed = existsSync(imagePath);
    if (!existed) {
      await downloadPixivOriginalImage(
        page.originalUrl,
        `${PIXIV_HOME_URL}artworks/${artworkId}`,
        imagePath
      );
    }
    networkCompletedPages += 1;
    updateExploreDownloadState({
      message: trustAsUserDownload
        ? `收藏作品 ${artworkId}：已下载 ${networkCompletedPages}/${pages.length} 页，等待加入画廊`
        : `作品 ${artworkId}：已下载 ${networkCompletedPages}/${pages.length} 页，等待审查入库`
    });
    return { page, imagePath, existed };
  });

  for (const { page, imagePath, existed } of localPages) {
    const localArtwork = database.importArtwork(imagePath);
    database.saveArtworkSource(localArtwork.id, {
      platform: "pixiv",
      workId: artworkId,
      pageIndex: page.index,
      authorId: metadata.authorId,
      authorName: metadata.authorName,
      title: metadata.title
    });
    if (trustAsUserDownload) {
      database.trustArtwork(localArtwork.id);
    } else if (!localArtwork.assessment || localArtwork.assessment.engine !== vision.engine) {
      await enqueueRemoteVisionTask(async () => {
        const assessment = await classifyFailClosed(vision!, imagePath, 30_000);
        const rules = buildElementFilterRules(database!.listElementFilterSettings(), customElementGroups());
        database!.saveAssessment(
          localArtwork.id,
          assessment,
          decideFilter(assessment, rules)
        );
      });
    }
    updateExploreDownloadState({
      completedPages: exploreDownloadState.completedPages + 1,
      skippedPages: exploreDownloadState.skippedPages + (existed ? 1 : 0),
      message: `作品 ${artworkId}：已处理 ${page.index + 1}/${pages.length} 页`
    });
  }
  return {
    downloadedPages: localPages.filter((item) => !item.existed).length,
    skippedPages: localPages.filter((item) => item.existed).length,
    fastPathed: false
  };
}

function isCompleteIndexedPixivWork(artworks: readonly ArtworkRecord[]): boolean {
  if (artworks.length === 0) return false;
  const pageIndexes = artworks
    .map((artwork) => artwork.source?.pageIndex)
    .filter((pageIndex): pageIndex is number => Number.isSafeInteger(pageIndex));
  if (pageIndexes.length !== artworks.length) return false;
  if (!hasContiguousPixivPages(pageIndexes)) return false;
  return artworks.every((artwork) => existsSync(artwork.path));
}


async function downloadPixivOriginalImage(
  imageUrl: string,
  referrer: string,
  destination: string,
  label = "原图"
): Promise<void> {
  await pixivDownloadNetworkGate.run(async () => {
    // Pixiv requires a full Referer for original images. Chromium Fetch treats
    // that header as protected here, while the display session also deliberately
    // filters artwork requests. Node Fetch can send it without exposing cookies.
    const response = await globalThis.fetch(imageUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: referrer
      }
    });
    await saveImageResponse(response, destination, label);
  });
}

async function saveImageResponse(
  response: Response,
  destination: string,
  label: string
): Promise<void> {
  if (!response.ok) throw new Error(`${label}下载失败：HTTP ${response.status}`);
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error(`${label}响应类型异常：${contentType || "unknown"}`);
  }
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > MAX_ORIGINAL_IMAGE_BYTES) {
    throw new Error(`${label}超过 128 MB 下载上限`);
  }
  if (!response.body) throw new Error(`${label}响应没有可读取的数据流`);
  const temporaryPath = `${destination}.${randomUUID()}.part`;
  let receivedBytes = 0;
  const sizeGuard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_ORIGINAL_IMAGE_BYTES) {
        callback(new Error(`${label}超过 128 MB 下载上限`));
        return;
      }
      callback(null, chunk);
    }
  });
  try {
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>
      ),
      sizeGuard,
      createWriteStream(temporaryPath, { flags: "wx" })
    );
    if (receivedBytes === 0) throw new Error(`${label}响应为空`);
    await rename(temporaryPath, destination);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function installPixivDomAdapter(contents: Electron.WebContents): Promise<void> {
  if (contents.isDestroyed()) return;
  try {
    await contents.executeJavaScript(
      buildPixivDomAdapterScript(pixivRevealToken),
      true
    );
  } catch (error) {
    console.error("[pixiv-dom-adapter] failed to install", error);
  }
}

function isExploreReviewCandidateMessage(value: unknown): value is {
  normalizedUrl: string;
  referrer: string;
  priority: ExploreReviewPriority;
} {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.normalizedUrl === "string" &&
    typeof message.referrer === "string" &&
    (message.priority === "visible" || message.priority === "near")
  );
}

function normalizeExploreReviewInactiveMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const normalizedUrl = (value as { normalizedUrl?: unknown }).normalizedUrl;
  return typeof normalizedUrl === "string"
    ? normalizePixivArtworkImageUrl(normalizedUrl)
    : null;
}

function enqueueExploreReview(
  contents: Electron.WebContents,
  normalizedUrl: string,
  referrer: string,
  priority: ExploreReviewPriority
): void {
  if (exploreActiveReview?.normalizedUrl === normalizedUrl) return;
  if (exploreReviewQueue.upsert({ normalizedUrl, referrer, priority })) {
    scheduleExploreState();
  }
  queueMicrotask(() => pumpExploreReviewQueue(contents));
}

function pumpExploreReviewQueue(contents: Electron.WebContents): void {
  if (exploreActiveReview || contents.isDestroyed()) return;
  const candidate = exploreReviewQueue.take();
  if (!candidate) {
    scheduleExploreState();
    return;
  }

  const generation = exploreReviewGeneration;
  exploreActiveReview = { normalizedUrl: candidate.normalizedUrl, generation };
  scheduleExploreState();
  const startedAt = Date.now();
  const queueWaitMs = Math.max(0, startedAt - candidate.enqueuedAt);

  void reviewRemoteArtwork(candidate.normalizedUrl, candidate.referrer)
    .then(async (outcome) => {
      const reviewMs = Date.now() - startedAt;
      console.info(
        `[explore-queue] ${outcome.state} ` +
        `${candidate.normalizedUrl} priority=${candidate.priority} source=${outcome.source} ` +
        `queueWaitMs=${queueWaitMs} reviewMs=${reviewMs}`
      );
      if (
        generation !== exploreReviewGeneration ||
        contents.isDestroyed() ||
        exploreView?.webContents.id !== contents.id
      ) {
        return;
      }
      await publishRemoteReviewOutcome(contents, candidate.normalizedUrl, outcome);
    })
    .catch((error: unknown) => {
      console.error("[explore-queue] unexpected review failure", error);
    })
    .finally(() => {
      if (
        exploreActiveReview?.normalizedUrl === candidate.normalizedUrl &&
        exploreActiveReview.generation === generation
      ) {
        exploreActiveReview = undefined;
      }
      scheduleExploreState();
      queueMicrotask(() => pumpExploreReviewQueue(contents));
    });
}

async function publishRemoteReviewOutcome(
  contents: Electron.WebContents,
  normalizedUrl: string,
  outcome: RemoteReviewOutcome
): Promise<void> {
  if (contents.isDestroyed()) return;
  contents.send("explore:review-result", {
    normalizedUrl,
    state: outcome.state,
    reasons: outcome.reasons
  });
}

function resetExploreReviewQueue(): void {
  exploreReviewGeneration += 1;
  exploreReviewQueue.clear();
  remoteOneShotAllows.clear();
}

function scheduleExploreState(): void {
  if (exploreStateTimer) return;
  exploreStateTimer = setTimeout(() => {
    exploreStateTimer = undefined;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("explore:state-changed", currentExploreState());
  }, 80);
}

interface RemoteReviewContext {
  settings: ReturnType<LibraryDatabase["listElementFilterSettings"]>;
  personalPreferences: PersonalTagPreferenceProfile;
  cacheKey: {
    normalizedUrl: string;
    engine: string;
    engineVersion: string;
    rulesFingerprint: string;
  };
  memoryKey: string;
}

function createRemoteReviewContext(imageUrl: string): RemoteReviewContext | null {
  if (!vision || !database) return null;
  const normalizedUrl = normalizePixivArtworkImageUrl(imageUrl);
  if (!normalizedUrl) return null;
  const settings = database.listElementFilterSettings();
  const preferences = personalTagPreferences();
  const cacheKey = {
    normalizedUrl,
    engine: vision.engine,
    engineVersion: vision.engineVersion,
    rulesFingerprint: activeExploreRulesFingerprint(settings, preferences)
  };
  return { settings, personalPreferences: preferences, cacheKey, memoryKey: JSON.stringify(cacheKey) };
}

function findCachedRemoteReview(imageUrl: string): RemoteReviewOutcome | null {
  if (isExplorePageException(imageUrl)) {
    return { state: "allowed", reasons: [], source: "preference" };
  }
  if (isExploreDislikePageException(imageUrl)) {
    return { state: "blocked", reasons: ["个人偏好：仅隐藏这张"], source: "preference" };
  }
  const context = createRemoteReviewContext(imageUrl);
  return context ? findCachedRemoteReviewForContext(context) : null;
}

function findCachedRemoteReviewForContext(
  context: RemoteReviewContext
): RemoteReviewOutcome | null {
  const cached = remoteReviewCache.get(context.memoryKey);
  if (cached !== undefined) {
    remoteReviewCache.delete(context.memoryKey);
    remoteReviewCache.set(context.memoryKey, cached);
    exploreRemoteReviewCacheHits += 1;
    scheduleExploreState();
    return { ...cached, source: "memory" };
  }

  const persisted = database?.getRemoteImageReview(context.cacheKey);
  if (!persisted) return null;
  const outcome: RemoteReviewOutcome = {
    state: persisted.decision.action === "allow" ? "allowed" : "blocked",
    reasons: persisted.decision.reasons.map(describeRemoteReviewReason),
    source: "persistent"
  };
  rememberRemoteReview(context.memoryKey, outcome);
  exploreRemoteReviewCacheHits += 1;
  scheduleExploreState();
  return outcome;
}

function rememberRemoteReview(memoryKey: string, outcome: RemoteReviewOutcome): void {
  remoteReviewCache.delete(memoryKey);
  remoteReviewCache.set(memoryKey, outcome);
  while (remoteReviewCache.size > MAX_MEMORY_REVIEW_CACHE_ENTRIES) {
    const oldestKey = remoteReviewCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    remoteReviewCache.delete(oldestKey);
  }
}

function reviewRemoteArtwork(
  imageUrl: string,
  referrer: string
): Promise<RemoteReviewOutcome> {
  if (isExplorePageException(imageUrl)) {
    return Promise.resolve({ state: "allowed", reasons: [], source: "preference" });
  }
  if (isExploreDislikePageException(imageUrl)) {
    return Promise.resolve({
      state: "blocked",
      reasons: ["个人偏好：仅隐藏这张"],
      source: "preference"
    });
  }
  if (!vision?.available || !database) {
    return Promise.resolve({
      state: "unavailable",
      reasons: ["视觉引擎不可用"],
      source: "error"
    });
  }
  const context = createRemoteReviewContext(imageUrl);
  if (!context) {
    return Promise.resolve({ state: "unavailable", reasons: ["无法检查这张图片"], source: "error" });
  }
  const cached = findCachedRemoteReviewForContext(context);
  if (cached) return Promise.resolve(cached);
  const activeReview = remoteReviewPending.get(context.memoryKey);
  if (activeReview) return activeReview;

  exploreRemoteReviewCacheMisses += 1;
  scheduleExploreState();

  explorePendingResources += 1;
  scheduleExploreState();

  const review = performRemoteArtworkReview(
    imageUrl,
    referrer,
    context.cacheKey,
    context.settings,
    context.personalPreferences
  )
    .catch((error: unknown) => {
      console.error(`[explore-review] ${imageUrl}`, error);
      if (!vision?.available) {
        exploreError = `本地保护模型已停止：${
          error instanceof Error ? error.message : "未知错误"
        }`;
        syncExploreProtectionVisibility();
      }
      return {
        state: "unavailable" as const,
        reasons: ["本次检查未完成"],
        source: "error" as const
      };
    })
    .then((reviewResult) => {
      if ("state" in reviewResult) return reviewResult;
      const outcome: RemoteReviewOutcome = {
        state: reviewResult.decision.action === "allow" ? "allowed" : "blocked",
        reasons: reviewResult.decision.reasons.map(describeRemoteReviewReason),
        source: "fresh"
      };
      rememberRemoteReview(context.memoryKey, outcome);
      database?.saveRemoteImageReview(reviewResult);
      if (outcome.state === "allowed") exploreApprovedResources += 1;
      else exploreBlockedResources += 1;
      return outcome;
    })
    .finally(() => {
      remoteReviewPending.delete(context.memoryKey);
      explorePendingResources = Math.max(0, explorePendingResources - 1);
      scheduleExploreState();
    });

  remoteReviewPending.set(context.memoryKey, review);
  return review;
}

async function performRemoteArtworkReview(
  imageUrl: string,
  referrer: string,
  cacheKey: {
    normalizedUrl: string;
    engine: string;
    engineVersion: string;
    rulesFingerprint: string;
  },
  settings: ReturnType<LibraryDatabase["listElementFilterSettings"]>,
  preferences: PersonalTagPreferenceProfile
): Promise<RemoteImageReviewRecord> {
  if (!vision?.available || !database) throw new Error("Vision engine is unavailable");

  const userAgent = exploreView?.webContents.getUserAgent() || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  // Never fetch AI-review bytes through the Explore Session: its webRequest
  // handler intentionally filters page images and can race with internal work.
  const imageBytes = await fetchPixivReviewImage(imageUrl, referrer, userAgent);

  const reviewDirectory = join(app.getPath("temp"), "digital-sanctuary-remote-review");
  await mkdir(reviewDirectory, { recursive: true });
  const extension = safeRemoteImageExtension(imageUrl);
  const digest = createHash("sha256").update(imageUrl).digest("hex");
  const imagePath = join(reviewDirectory, `${digest}${extension}`);
  await writeFile(imagePath, imageBytes);

  try {
    return await enqueueRemoteVisionTask(async () => {
      const assessment = await classifyFailClosed(vision!, imagePath, 30_000);
      if (assessment.status === "error") {
        throw new Error(assessment.error ?? "Vision engine failed");
      }
      if (
        assessment.engine !== cacheKey.engine ||
        assessment.engineVersion !== cacheKey.engineVersion
      ) {
        throw new Error("Vision engine version changed during review");
      }
      const rules = buildElementFilterRules(
        settings,
        customElementGroups(),
        adaptiveThresholdOverrides()
      );
      const hardDecision = decideFilter(assessment, rules);
      const decision = hardDecision.action === "allow"
        ? decidePersonalPreference(assessment, preferences)
        : hardDecision;
      if (decision.action !== "allow") {
        console.warn(
          `[explore-review] blocked ${imageUrl}: ${decision.reasons
            .map((reason) => `${reason.label}=${reason.confidence.toFixed(3)}`)
            .join(", ")}`
        );
      }
      return {
        ...cacheKey,
        contentHash: createHash("sha256").update(imageBytes).digest("hex"),
        assessment,
        decision,
        byteLength: imageBytes.length,
        reviewedAt: new Date().toISOString()
      };
    });
  } finally {
    await unlink(imagePath).catch(() => undefined);
  }
}

function describeRemoteReviewReason(reason: { ruleId: string; ruleName: string; label: string }): string {
  return reason.ruleId.startsWith("personal-preference:") ? reason.ruleName : reason.label;
}

function enqueueRemoteVisionTask<T>(task: () => Promise<T>): Promise<T> {
  const result = remoteVisionQueue.then(task, task);
  remoteVisionQueue = result.then(() => undefined, () => undefined);
  return result;
}

function safeRemoteImageExtension(imageUrl: string): string {
  try {
    const extension = extname(new URL(imageUrl).pathname).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"].includes(extension)
      ? extension
      : ".img";
  } catch {
    return ".img";
  }
}

function recalculateStoredDecisions(target: LibraryDatabase): void {
  const groups = target.getPreference<unknown>("filters.custom-groups");
  const rules = buildElementFilterRules(
    target.listElementFilterSettings(),
    Array.isArray(groups) ? groups.filter(isCustomElementGroup) : []
  );
  for (const artwork of target.listArtworks()) {
    if (!artwork.assessment) continue;
    target.saveAssessment(
      artwork.id,
      artwork.assessment,
      decideFilter(artwork.assessment, rules)
    );
  }
}

async function classifyFailClosed(
  client: VisionClient,
  imagePath: string,
  timeoutMs = 5_000
): Promise<VisionAssessment> {
  try {
    return await client.classify(imagePath, timeoutMs);
  } catch (error) {
    return {
      status: "error",
      engine: "unavailable",
      engineVersion: "0",
      labels: {},
      elapsedMs: 0,
      error: error instanceof Error ? error.message : "Vision engine failed"
    };
  }
}

function parseThemeRepository(value: string | undefined): { owner: string; repository: string } | null {
  if (!value) return null;
  const match = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/.exec(value.trim());
  return match?.[1] && match[2] ? { owner: match[1], repository: match[2] } : null;
}

function resolveVisionProcess(): VisionProcessOptions {
  if (app.isPackaged) {
    const executable = join(process.resourcesPath, "vision-runtime", "sanctuary-vision.exe");
    const modelDirectory = join(process.resourcesPath, "models", "wd-swinv2-tagger-v3");
    return {
      executable,
      args: [],
      engine: "wd-swinv2-tagger-v3",
      engineVersion: "v3/e6774bff34d4/ort-1.28.0",
      executionProvider: "CPU",
      env: { WD_TAGGER_MODEL_DIR: modelDirectory }
    };
  }

  const projectRoot = resolve(
    moduleDirectory,
    "..",
    "..",
    "..",
    ".."
  );
  const python = join(projectRoot, ".venv", "Scripts", "python.exe");
  const gpuPython = join(projectRoot, ".venv-gpu", "Scripts", "python.exe");
  const pythonServer = join(projectRoot, "services", "vision", "python", "server.py");
  const wdModel = join(projectRoot, "models", "wd-swinv2-tagger-v3", "model.onnx");
  const wdTags = join(projectRoot, "models", "wd-swinv2-tagger-v3", "selected_tags.csv");

  if (existsSync(gpuPython) && existsSync(pythonServer) && existsSync(wdModel) && existsSync(wdTags)) {
    return {
      executable: gpuPython,
      args: [pythonServer],
      engine: "wd-swinv2-tagger-v3",
      engineVersion: "v3/e6774bff34d4/ort-1.28.0",
      executionProvider: "CUDA（CPU 回退）",
      env: { SANCTUARY_ONNX_PROVIDER: "cuda" }
    };
  }

  if (existsSync(python) && existsSync(pythonServer) && existsSync(wdModel) && existsSync(wdTags)) {
    return {
      executable: python,
      args: [pythonServer],
      engine: "wd-swinv2-tagger-v3",
      engineVersion: "v3/e6774bff34d4/ort-1.28.0",
      executionProvider: "CPU"
    };
  }

  return {
    executable: process.execPath,
    args: [join(projectRoot, "services", "vision", "dist", "index.js")],
    engine: "filename-probe",
    engineVersion: "0.1.0",
    env: { ELECTRON_RUN_AS_NODE: "1" }
  };
}
