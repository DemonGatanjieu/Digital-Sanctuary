import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  type Session,
  WebContentsView
} from "electron";
import { LibraryDatabase, type RemoteImageReviewRecord } from "@sanctuary/database";
import {
  buildElementFilterRules,
  decideFilter,
  isElementFilterSetting,
  rulesFingerprint,
  type VisionAssessment
} from "@sanctuary/domain";
import { VisionClient } from "./vision-client.js";
import type { VisionProcessOptions } from "./vision-client.js";
import {
  ExploreReviewQueue,
  type ExploreReviewPriority
} from "./explore-review-queue.js";
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
  IDLE_EXPLORE_DOWNLOAD_STATE,
  parsePixivArtworkMetadata,
  parsePixivArtworkPages,
  parsePixivBookmarkPage,
  parsePixivPageContext,
  safePixivImageExtension,
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

protocol.registerSchemesAsPrivileged([
  {
    scheme: "sanctuary-image",
    privileges: { secure: true, standard: true, supportFetchAPI: true }
  }
]);

let database: LibraryDatabase | undefined;
let vision: VisionClient | undefined;
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
interface RemoteReviewOutcome {
  allowed: boolean;
  reasons: string[];
  source: "memory" | "persistent" | "fresh" | "error";
}

const remoteReviewCache = new Map<string, RemoteReviewOutcome>();
const remoteReviewPending = new Map<string, Promise<RemoteReviewOutcome>>();
const exploreReviewQueue = new ExploreReviewQueue();
const pixivRevealToken = randomUUID();
const remoteOneShotAllows = new Set<string>();
let remoteVisionQueue: Promise<void> = Promise.resolve();
let exploreActiveReview: { normalizedUrl: string; generation: number } | undefined;
let exploreReviewGeneration = 0;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ORIGINAL_IMAGE_BYTES = 128 * 1024 * 1024;
const MAX_MEMORY_REVIEW_CACHE_ENTRIES = 500;
const PIXIV_BOOKMARK_PAGE_SIZE = 48;
const PIXIV_DOWNLOAD_CONCURRENCY = 4;
const ENABLE_VIEWPORT_REVIEW = false;
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

  app.whenReady().then(() => {
    database = new LibraryDatabase(join(app.getPath("userData"), "library.db"));
    vision = new VisionClient(resolveVisionProcess());
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
  vision?.close();
  database?.close();
});

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#f7f8fa",
    title: "纯净领域",
    webPreferences: {
      preload: join(moduleDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  window.on("maximize", scheduleExploreState);
  window.on("unmaximize", scheduleExploreState);
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

function registerIpc(): void {
  ipcMain.handle("library:list", () => database?.listArtworks() ?? []);
  ipcMain.handle("collections:list", () => database?.listCollections() ?? []);
  ipcMain.handle("artists:list", () => database?.listArtists() ?? []);

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

    const rules = buildElementFilterRules(database.listElementFilterSettings());
    for (const imagePath of selected.filePaths) {
      const artwork = database.importArtwork(imagePath);
      const assessment = await classifyFailClosed(vision, imagePath);
      const decision = decideFilter(assessment, rules);
      database.saveAssessment(artwork.id, assessment, decision);
    }
    return database.listArtworks();
  });

  ipcMain.handle("filters:list", () => database?.listElementFilterSettings() ?? []);
  ipcMain.handle("filters:update", (_event, setting: unknown) => {
    if (!database || !isElementFilterSetting(setting)) {
      throw new Error("Invalid element filter setting");
    }
    database.saveElementFilterSetting(setting);
    recalculateStoredDecisions(database);
    remoteReviewCache.clear();
    return database.listElementFilterSettings();
  });

  ipcMain.handle("explore:show", (_event, bounds: unknown) => {
    const parsedBounds = parseExploreBounds(bounds);
    if (!parsedBounds) throw new Error("Invalid exploration bounds");
    exploreBounds = parsedBounds;
    const view = ensureExploreView();
    view.setBounds(parsedBounds);
    view.setVisible(true);
    exploreVisible = true;
    if (!view.webContents.getURL()) void view.webContents.loadURL(PIXIV_HOME_URL);
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
    else if (command === "maximize" && mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
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
            fastPathed = !!result.fastPathed;
          } catch (error) {
            failedArtworks += 1;
            console.error(`[pixiv-download] artwork ${artworkId}`, error);
            fastPathed = false;
          }
          updateExploreDownloadState({ completedArtworks, failedArtworks });

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

  ipcMain.handle("collections:create", (_event, name: unknown) => {
    if (!database || typeof name !== "string") throw new Error("Invalid collection name");
    database.createCollection(name);
    return database.listCollections();
  });

  ipcMain.handle("collections:update-cover", (_event, collectionId: unknown, artworkId: unknown) => {
    if (!database || typeof collectionId !== "string" || (artworkId !== null && typeof artworkId !== "string")) {
      throw new Error("Invalid collection cover assignment");
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

  ipcMain.handle("app:status", () => ({
    visionEngine: vision?.engine ?? "unavailable",
    visionProvider: vision?.executionProvider ?? "unknown",
    visionReady: vision?.available ?? false,
    modelBacked: vision?.engine === "wd-swinv2-tagger-v3"
  }));
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
        const normalizedUrl = normalizePixivArtworkImageUrl(details.url);
        if (normalizedUrl && remoteOneShotAllows.delete(normalizedUrl)) {
          callback({ cancel: false });
          return;
        }
        if (!normalizedUrl) {
          callback({ cancel: true });
          return;
        }
        if (!ENABLE_VIEWPORT_REVIEW) {
          void reviewRemoteArtwork(details.url, details.referrer, exploreSession)
            .then(async (outcome) => {
              if (!outcome.allowed) {
                await contents.executeJavaScript(
                  buildPixivBlockedReviewScript(normalizedUrl, outcome.reasons),
                  true
                ).catch((error: unknown) => {
                  console.error("[pixiv-placeholder] failed to install", error);
                });
              }
              callback({ cancel: !outcome.allowed });
            })
            .catch(() => callback({ cancel: true }));
          return;
        }
        const cached = findCachedRemoteReview(normalizedUrl);
        callback({ cancel: cached ? !cached.allowed : true });
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
    void installPixivDomAdapter(contents);
  });
  contents.on("did-stop-loading", () => {
    void installPixivDomAdapter(contents);
    scheduleExploreState();
  });
  contents.on("did-navigate", () => {
    void installPixivDomAdapter(contents);
    scheduleExploreState();
  });
  contents.on("did-navigate-in-page", () => {
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
  
  if (database?.listArtworks().some(a => a.source?.platform === "pixiv" && a.source?.workId === context.artworkId)) {
    throw new Error("该作品已在本地画廊中，无需重复下载");
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
        phase: "complete",
        completedArtworks: result.completedArtworks,
        failedArtworks: result.failedArtworks,
        message: result.failedArtworks > 0
          ? `已保存 ${result.completedArtworks} 个作品，${result.failedArtworks} 个失败`
          : `已保存 ${result.completedArtworks} 个作品到本地画廊`
      });
      return result;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "下载失败";
      updateExploreDownloadState({ phase: "error", message });
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
  return join(app.getPath("pictures"), "Digital Sanctuary", "Pixiv");
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

let nextPixivApiCall = 0;
const PIXIV_API_DELAY_MS = 600;

async function fetchPixivJson(
  targetSession: Session,
  url: string,
  referrer: string
): Promise<unknown> {
  return pixivDownloadNetworkGate.run(async () => {
    let attempt = 0;
    while (true) {
      const now = Date.now();
      const waitTime = Math.max(0, nextPixivApiCall - now);
      nextPixivApiCall = now + waitTime + PIXIV_API_DELAY_MS;
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      let response: Response;
      try {
        response = await targetSession.fetch(url, {
          credentials: "include",
          referrer,
          headers: {
            Accept: "application/json",
            Referer: referrer
          },
          bypassCustomProtocolHandlers: true
        });
      } catch (networkError) {
        if (attempt < 5) {
          attempt++;
          const backoffMs = Math.pow(2, attempt) * 15000;
          updateExploreDownloadState({
            message: `网络或连接异常，安全休眠 ${backoffMs / 1000} 秒...`
          });
          console.warn(`[Pixiv Network Error] on ${url}, backing off for ${backoffMs}ms`, networkError);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          nextPixivApiCall = Date.now();
          continue;
        }
        throw networkError;
      }
      
      // 对于 403 Forbidden，很有可能是因为下载请求太快被 Cloudflare 拦截
      // 也纳入退避重试，以免直接崩溃跳过
      if (response.status === 401 || response.status === 403) {
        if (response.status === 403 && attempt < 5) {
          attempt++;
          const backoffMs = Math.pow(2, attempt) * 15000;
          updateExploreDownloadState({
            message: `触发拦截 (HTTP 403)，安全休眠 ${backoffMs / 1000} 秒...`
          });
          console.warn(`[Pixiv 403 Forbidden] on ${url}, backing off for ${backoffMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          nextPixivApiCall = Date.now();
          continue;
        }
        throw new Error("Pixiv 会话未登录或无权读取这些作品");
      }
      if (!response.ok) {
        if (response.status === 429) {
          if (attempt < 5) {
            attempt++;
            const backoffMs = Math.pow(2, attempt) * 15000; // 30s, 60s, 120s, 240s, 480s
            updateExploreDownloadState({
              message: `触发防封禁保护，安全休眠 ${backoffMs / 1000} 秒...`
            });
            console.warn(`[Pixiv Rate Limit] 429 received on ${url}, backing off for ${backoffMs}ms (Attempt ${attempt})`);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            nextPixivApiCall = Date.now(); // reset queue spacing
            continue;
          }
          throw new Error("P 站触发了频率限制 (HTTP 429)，已达到最大重试次数");
        }
        throw new Error(`Pixiv 数据请求失败：HTTP ${response.status}`);
      }
      try {
        return await response.json();
      } catch {
        throw new Error("Pixiv 返回的不是有效 JSON 数据");
      }
    }
  });
}

async function downloadPixivArtwork(
  artworkId: string,
  resetPageTotal: boolean,
  trustAsUserDownload: boolean
): Promise<{ downloadedPages: number; skippedPages: number; fastPathed?: boolean }> {
  if (!database || !vision) throw new Error("本地画廊或视觉引擎尚未准备好");

  const localArtworks = database.listArtworks().filter((a) => a.source?.platform === "pixiv" && a.source?.workId === artworkId);
  if (localArtworks.length > 0) {
    const authorId = localArtworks[0]?.source?.authorId;
    if (authorId) {
      const existingArtist = database.listArtists().find((a) => a.id === authorId);
      // Fast path is only valid if we don't have a pending avatar to download
      if (existingArtist && (!existingArtist.avatarUrl || existingArtist.avatarLocalPath)) {
        for (const local of localArtworks) {
          if (trustAsUserDownload) database.trustArtwork(local.id);
        }
        return { downloadedPages: 0, skippedPages: localArtworks.length, fastPathed: true };
      }
    }
  }

  const targetSession = requireExploreSession();
  const [pages, metadata] = await Promise.all([
    fetchPixivArtworkPages(targetSession, artworkId),
    fetchPixivArtworkMetadata(targetSession, artworkId)
  ]);
  updateExploreDownloadState({
    phase: "downloading",
    totalPages: resetPageTotal
      ? pages.length
      : exploreDownloadState.totalPages + pages.length,
    message: `正在保存作品 ${artworkId}（共 ${pages.length} 页）`
  });

  let avatarLocalPath: string | null = null;
  const existingArtistBefore = database.listArtists().find(a => a.id === metadata.authorId);
  if (existingArtistBefore?.avatarLocalPath) {
    avatarLocalPath = existingArtistBefore.avatarLocalPath;
  }
  
  if (metadata.authorAvatarUrl && !avatarLocalPath) {
    const extension = safePixivImageExtension(metadata.authorAvatarUrl);
    const avatarDir = join(pixivGalleryDirectory(), "..", "avatars");
    await mkdir(avatarDir, { recursive: true });
    const newAvatarLocalPath = join(avatarDir, `${metadata.authorId}${extension}`);
    if (!existsSync(newAvatarLocalPath)) {
      try {
        await downloadPixivOriginalImage(metadata.authorAvatarUrl, `${PIXIV_HOME_URL}users/${metadata.authorId}`, newAvatarLocalPath);
        avatarLocalPath = newAvatarLocalPath;
      } catch (err) {
        console.error("Failed to download avatar", err);
      }
    } else {
      avatarLocalPath = newAvatarLocalPath;
    }
  }

  database.importArtist({
    id: metadata.authorId,
    name: metadata.authorName,
    avatarUrl: metadata.authorAvatarUrl,
    avatarLocalPath,
    updatedAt: new Date().toISOString()
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
        const rules = buildElementFilterRules(database!.listElementFilterSettings());
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
    skippedPages: localPages.filter((item) => item.existed).length
  };
}

async function downloadPixivOriginalImage(
  imageUrl: string,
  referrer: string,
  destination: string
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
    if (!response.ok) throw new Error(`原图下载失败：HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      throw new Error(`原图响应类型异常：${contentType || "unknown"}`);
    }
    const declaredSize = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredSize) && declaredSize > MAX_ORIGINAL_IMAGE_BYTES) {
      throw new Error("原图超过 128 MB 下载上限");
    }
    if (!response.body) throw new Error("原图响应没有可读取的数据流");
    const temporaryPath = `${destination}.${randomUUID()}.part`;
    let receivedBytes = 0;
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_ORIGINAL_IMAGE_BYTES) {
          callback(new Error("原图超过 128 MB 下载上限"));
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
      if (receivedBytes === 0) throw new Error("原图响应为空");
      await rename(temporaryPath, destination);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  });
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

  void reviewRemoteArtwork(candidate.normalizedUrl, candidate.referrer, contents.session)
    .then(async (outcome) => {
      const reviewMs = Date.now() - startedAt;
      console.info(
        `[explore-queue] ${outcome.allowed ? "allow" : "block"} ` +
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
    state: outcome.allowed ? "allowed" : "blocked",
    reasons: outcome.reasons
  });
  if (outcome.allowed) return;
  await contents.executeJavaScript(
    buildPixivBlockedReviewScript(normalizedUrl, outcome.reasons),
    true
  ).catch((error: unknown) => {
    console.error("[pixiv-placeholder] failed to install", error);
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
  const cacheKey = {
    normalizedUrl,
    engine: vision.engine,
    engineVersion: vision.engineVersion,
    rulesFingerprint: rulesFingerprint(settings)
  };
  return { settings, cacheKey, memoryKey: JSON.stringify(cacheKey) };
}

function findCachedRemoteReview(imageUrl: string): RemoteReviewOutcome | null {
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
    allowed: persisted.decision.action === "allow",
    reasons: persisted.decision.reasons.map((reason) => reason.label),
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
  referrer: string,
  exploreSession: Session
): Promise<RemoteReviewOutcome> {
  if (!vision || !database) {
    return Promise.resolve({
      allowed: false,
      reasons: ["视觉引擎不可用"],
      source: "error"
    });
  }
  const context = createRemoteReviewContext(imageUrl);
  if (!context) {
    return Promise.resolve({ allowed: false, reasons: ["无效图片地址"], source: "error" });
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
    exploreSession,
    context.cacheKey,
    context.settings
  )
    .catch((error: unknown) => {
      console.error(`[explore-review] ${imageUrl}`, error);
      exploreError = `图片审查失败，已保持遮挡：${
        error instanceof Error ? error.message : "未知错误"
      }`;
      return {
        allowed: false,
        reasons: ["审查失败，默认保持遮挡"],
        source: "error" as const
      };
    })
    .then((reviewResult) => {
      if ("allowed" in reviewResult) return reviewResult;
      const outcome: RemoteReviewOutcome = {
        allowed: reviewResult.decision.action === "allow",
        reasons: reviewResult.decision.reasons.map((reason) => reason.label),
        source: "fresh"
      };
      rememberRemoteReview(context.memoryKey, outcome);
      database?.saveRemoteImageReview(reviewResult);
      if (outcome.allowed) exploreApprovedResources += 1;
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
  exploreSession: Session,
  cacheKey: {
    normalizedUrl: string;
    engine: string;
    engineVersion: string;
    rulesFingerprint: string;
  },
  settings: ReturnType<LibraryDatabase["listElementFilterSettings"]>
): Promise<RemoteImageReviewRecord> {
  if (!vision?.available || !database) throw new Error("Vision engine is unavailable");

  const safeReferrer = isAllowedPixivNavigation(referrer) ? referrer : PIXIV_HOME_URL;
  const response = await exploreSession.fetch(imageUrl, {
    referrer: safeReferrer,
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      Referer: safeReferrer
    },
    bypassCustomProtocolHandlers: true
  });
  if (!response.ok) throw new Error(`Thumbnail download failed: HTTP ${response.status}`);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Unexpected thumbnail content type: ${contentType || "unknown"}`);
  }
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error("Thumbnail exceeds the review size limit");
  }

  const imageBytes = Buffer.from(await response.arrayBuffer());
  if (imageBytes.length === 0 || imageBytes.length > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error("Thumbnail is empty or exceeds the review size limit");
  }

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
      const rules = buildElementFilterRules(settings);
      const decision = decideFilter(assessment, rules);
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
  const rules = buildElementFilterRules(target.listElementFilterSettings());
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

function resolveVisionProcess(): VisionProcessOptions {
  if (app.isPackaged) {
    return {
      executable: process.execPath,
      args: [join(process.resourcesPath, "vision", "index.js")],
      engine: "filename-probe",
      engineVersion: "0.1.0",
      env: { ELECTRON_RUN_AS_NODE: "1" }
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
