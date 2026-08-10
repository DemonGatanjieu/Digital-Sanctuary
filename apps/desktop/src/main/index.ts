import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
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
let exploreBlockedFirstPartyPromotions = 0;
let exploreRemoteReviewCacheHits = 0;
let exploreRemoteReviewCacheMisses = 0;
let exploreError = "";
let exploreStateTimer: ReturnType<typeof setTimeout> | undefined;
let explorePromotionStatsTimer: ReturnType<typeof setInterval> | undefined;
interface RemoteReviewOutcome {
  allowed: boolean;
  reasons: string[];
}

const remoteReviewCache = new Map<string, RemoteReviewOutcome>();
const remoteReviewPending = new Map<string, Promise<RemoteReviewOutcome>>();
const pixivRevealToken = randomUUID();
const remoteOneShotAllows = new Set<string>();
let remoteVisionQueue: Promise<void> = Promise.resolve();
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024;

interface ExploreState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  blockedResources: number;
  blockedAds: number;
  blockedFirstPartyPromotions: number;
  approvedResources: number;
  pendingResources: number;
  remoteReviewCacheHits: number;
  remoteReviewCacheMisses: number;
  error: string;
  maximized: boolean;
}

app.whenReady().then(() => {
  database = new LibraryDatabase(join(app.getPath("userData"), "library.db"));
  vision = new VisionClient(resolveVisionProcess());
  database.invalidateAssessmentsExcept(vision.engine);
  database.pruneRemoteImageReviews();
  registerImageProtocol();
  registerIpc();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (exploreStateTimer) clearTimeout(exploreStateTimer);
  if (explorePromotionStatsTimer) clearInterval(explorePromotionStatsTimer);
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
    if (!database?.hasArtworkPath(imagePath) || !existsSync(imagePath)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(imagePath).toString());
  });
}

function registerIpc(): void {
  ipcMain.handle("library:list", () => database?.listArtworks() ?? []);
  ipcMain.handle("collections:list", () => database?.listCollections() ?? []);

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

  ipcMain.handle("collections:create", (_event, name: unknown) => {
    if (!database || typeof name !== "string") throw new Error("Invalid collection name");
    database.createCollection(name);
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
  explorePromotionStatsTimer = setInterval(() => {
    void installPixivDomAdapter(contents);
  }, 1_000);
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
        void reviewRemoteArtwork(details.url, details.referrer, exploreSession)
          .then(async (outcome) => {
            if (!outcome.allowed && normalizedUrl) {
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
    scheduleExploreState();
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
  if (!contents || contents.isDestroyed()) {
    return {
      url: PIXIV_HOME_URL,
      title: "Pixiv 探索",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      blockedResources: exploreBlockedResources,
      blockedAds: exploreBlockedAds,
      blockedFirstPartyPromotions: exploreBlockedFirstPartyPromotions,
      approvedResources: exploreApprovedResources,
      pendingResources: explorePendingResources,
      remoteReviewCacheHits: exploreRemoteReviewCacheHits,
      remoteReviewCacheMisses: exploreRemoteReviewCacheMisses,
      error: exploreError,
      maximized: mainWindow?.isMaximized() ?? false
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
    blockedFirstPartyPromotions: exploreBlockedFirstPartyPromotions,
    approvedResources: exploreApprovedResources,
    pendingResources: explorePendingResources,
    remoteReviewCacheHits: exploreRemoteReviewCacheHits,
    remoteReviewCacheMisses: exploreRemoteReviewCacheMisses,
    error: exploreError,
    maximized: mainWindow?.isMaximized() ?? false
  };
}

async function installPixivDomAdapter(contents: Electron.WebContents): Promise<void> {
  if (contents.isDestroyed()) return;
  try {
    const hiddenCount = await contents.executeJavaScript(
      buildPixivDomAdapterScript(pixivRevealToken),
      true
    );
    if (typeof hiddenCount === "number" && hiddenCount > 0) {
      exploreBlockedFirstPartyPromotions = Math.max(
        exploreBlockedFirstPartyPromotions,
        hiddenCount
      );
      scheduleExploreState();
    }
  } catch (error) {
    console.error("[pixiv-dom-adapter] failed to install", error);
  }
}

function scheduleExploreState(): void {
  if (exploreStateTimer) return;
  exploreStateTimer = setTimeout(() => {
    exploreStateTimer = undefined;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("explore:state-changed", currentExploreState());
  }, 80);
}

function reviewRemoteArtwork(
  imageUrl: string,
  referrer: string,
  exploreSession: Session
): Promise<RemoteReviewOutcome> {
  if (!vision || !database) return Promise.resolve({ allowed: false, reasons: ["视觉引擎不可用"] });
  const settings = database.listElementFilterSettings();
  const normalizedUrl = normalizePixivArtworkImageUrl(imageUrl);
  if (!normalizedUrl) return Promise.resolve({ allowed: false, reasons: ["无效图片地址"] });
  const cacheKey = {
    normalizedUrl,
    engine: vision.engine,
    engineVersion: vision.engineVersion,
    rulesFingerprint: rulesFingerprint(settings)
  };
  const memoryKey = JSON.stringify(cacheKey);
  const cached = remoteReviewCache.get(memoryKey);
  if (cached !== undefined) {
    exploreRemoteReviewCacheHits += 1;
    return Promise.resolve(cached);
  }

  const persisted = database.getRemoteImageReview(cacheKey);
  if (persisted) {
    const outcome = {
      allowed: persisted.decision.action === "allow",
      reasons: persisted.decision.reasons.map((reason) => reason.label)
    };
    remoteReviewCache.set(memoryKey, outcome);
    exploreRemoteReviewCacheHits += 1;
    return Promise.resolve(outcome);
  }
  const activeReview = remoteReviewPending.get(memoryKey);
  if (activeReview) return activeReview;

  exploreRemoteReviewCacheMisses += 1;
  scheduleExploreState();

  explorePendingResources += 1;
  scheduleExploreState();

  const review = performRemoteArtworkReview(
    imageUrl,
    referrer,
    exploreSession,
    cacheKey,
    settings
  )
    .catch((error: unknown) => {
      console.error(`[explore-review] ${imageUrl}`, error);
      exploreError = `图片审查失败，已保持遮挡：${
        error instanceof Error ? error.message : "未知错误"
      }`;
      return { allowed: false, reasons: ["审查失败，默认保持遮挡"] };
    })
    .then((reviewResult) => {
      if ("allowed" in reviewResult) return reviewResult;
      const outcome = {
        allowed: reviewResult.decision.action === "allow",
        reasons: reviewResult.decision.reasons.map((reason) => reason.label)
      };
      remoteReviewCache.set(memoryKey, outcome);
      database?.saveRemoteImageReview(reviewResult);
      if (outcome.allowed) exploreApprovedResources += 1;
      else exploreBlockedResources += 1;
      return outcome;
    })
    .finally(() => {
      remoteReviewPending.delete(memoryKey);
      explorePendingResources = Math.max(0, explorePendingResources - 1);
      scheduleExploreState();
    });

  remoteReviewPending.set(memoryKey, review);
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
  const pythonServer = join(projectRoot, "services", "vision", "python", "server.py");
  const wdModel = join(projectRoot, "models", "wd-swinv2-tagger-v3", "model.onnx");
  const wdTags = join(projectRoot, "models", "wd-swinv2-tagger-v3", "selected_tags.csv");

  if (existsSync(python) && existsSync(pythonServer) && existsSync(wdModel) && existsSync(wdTags)) {
    return {
      executable: python,
      args: [pythonServer],
      engine: "wd-swinv2-tagger-v3",
      engineVersion: "v3/e6774bff34d4/ort-1.28.0"
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
