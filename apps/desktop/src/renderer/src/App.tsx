import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type AppearancePreferences,
  type ArtistRecord,
  type GalleryScope,
  type CollectionRecord,
  type CustomElementGroup,
  type ElementFilterSetting,
  DEFAULT_LIBRARY_PREFERENCES,
  type LibraryPreferences,
  type SavedCollectionViewDraft,
  type StorageLocationInfo,
} from "@sanctuary/domain";
import type { ExploreState } from "../../preload/index";
import type { CollectionDraft } from "./CollectionEditor";
import { ElementInspectorDrawer, type ElementInspectorTarget } from "./ElementInspectorDrawer";
import { ExploreView, initialExploreState } from "./ExploreView";
import { AppSidebar, type ActiveView, type AppStatus } from "./AppSidebar";
import { GalleryView, type GalleryMode } from "./GalleryView";
import type { SettingsSection } from "./app-navigation";
import type { HomeDestination } from "./HomeView";
import type { BookmarkDownloadPreview } from "../../shared/pixiv-download.js";
import { useGalleryPictureSearch } from "./useGalleryPictureSearch";
import { useLibraryQuery } from "./useLibraryQuery";
import { useGalleryDirectory } from "./useGalleryDirectory";
import { GalleryDetailSessionCache, type GalleryDetailScope, type GalleryDetailSessionPatch } from "./gallery-detail-session";
import { galleryScopeKey } from "./gallery-model";
import { QuickActions, type QuickAction } from "./QuickActions";
import { useLocalImport } from "./useLocalImport";
import { useAnalysisTasks } from "./useAnalysisTasks";
import { activeTaskCount, INITIAL_THUMBNAIL_ACTIVITY, type ThumbnailActivity } from "./task-center-model";
import { AppNotice } from "./AppNotice";
import { animateButtonClick } from "./button-feedback";
import { applyWorkPreset, clearWorkCollectionFilters, type WorkPreset, type WorkSortSnapshot } from "./work-presets";

const SettingsView = lazy(() => import("./SettingsView").then((module) => ({ default: module.SettingsView })));
const ImportImagesDialog = lazy(() => import("./ImportImagesDialog").then((module) => ({ default: module.ImportImagesDialog })));
const TaskCenter = lazy(() => import("./TaskCenter").then((module) => ({ default: module.TaskCenter })));
const HomeView = lazy(() => import("./HomeView").then((module) => ({ default: module.HomeView })));
const ExploreProtectionPanel = lazy(() => import("./ExploreProtectionPanel").then((module) => ({ default: module.ExploreProtectionPanel })));
const AnalysisView = lazy(() => import("./AnalysisView").then((module) => ({ default: module.AnalysisView })));
const InspirationView = lazy(() => import("./InspirationView").then((module) => ({ default: module.InspirationView })));
const CollectionEditor = lazy(() => import("./CollectionEditor").then((module) => ({ default: module.CollectionEditor })));
const BookmarkDownloadDialog = lazy(() => import("./BookmarkDownloadDialog").then((module) => ({ default: module.BookmarkDownloadDialog })));

const DEFAULT_APPEARANCE: AppearancePreferences = {
  displayProfile: "balanced",
  reducedMotion: false,
  ambientArtwork: true
};

export function App() {
  const [activeView, setActiveViewState] = useState<ActiveView>("home");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("library");
  const mainRef = useRef<HTMLElement>(null);
  const [galleryScope, setGalleryScopeState] = useState<GalleryScope | null>(null);
  const detailSessions = useRef<GalleryDetailSessionCache | null>(null);
  if (!detailSessions.current) detailSessions.current = new GalleryDetailSessionCache();
  const [, setDetailRevision] = useState(0);
  const detailCapture = useRef<{ scope: GalleryDetailScope; capture: () => GalleryDetailSessionPatch } | null>(null);
  const [thumbnailRevision, setThumbnailRevision] = useState(0);
  const [thumbnailActivity, setThumbnailActivity] = useState<ThumbnailActivity>(INITIAL_THUMBNAIL_ACTIVITY);
  const [tasksOpen, setTasksOpen] = useState(false);
  const analysisTasks = useAnalysisTasks(tasksOpen);
  const [workbenchSource,setWorkbenchSource]=useState<"library"|"folder"|null>(null);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [protectionOpen, setProtectionOpen] = useState(false);
  const [protectionBusy, setProtectionBusy] = useState(false);
  const [pendingSearchFocus, setPendingSearchFocus] = useState(false);
  const nativeQuickActions = useRef(false);
  const nativeFocusPending = useRef(false);
  const blockingAppOverlay = useRef(false);
  const scrollPositions = useRef(new Map<string, number>());
  const previousView = useRef<ActiveView>("home");
  const [collectionEditor, setCollectionEditor] = useState<CollectionRecord | "new" | null>(null);
  const [collectionSaving, setCollectionSaving] = useState(false);
  const [appearance, setAppearance] = useState<AppearancePreferences>(DEFAULT_APPEARANCE);
  useLayoutEffect(() => {
    document.body.dataset.displayProfile = appearance.displayProfile;
    document.body.dataset.reducedMotion = String(appearance.reducedMotion);
    return () => { delete document.body.dataset.displayProfile; delete document.body.dataset.reducedMotion; };
  }, [appearance.displayProfile, appearance.reducedMotion]);
  const [libraryPreferences, setLibraryPreferences] = useState<LibraryPreferences>(DEFAULT_LIBRARY_PREFERENCES);
  const [storageLocation, setStorageLocation] = useState<StorageLocationInfo | null>(null);
  const [customElementGroups, setCustomElementGroups] = useState<CustomElementGroup[]>([]);
  const [bookmarkPreview, setBookmarkPreview] = useState<BookmarkDownloadPreview | null>(null);
  const [startingBookmarkDownload, setStartingBookmarkDownload] = useState(false);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [artists, setArtists] = useState<ArtistRecord[]>([]);
  const [filterSettings, setFilterSettings] = useState<ElementFilterSetting[]>([]);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [repairingAvatars, setRepairingAvatars] = useState(false);
  const [avatarRepairMessage, setAvatarRepairMessage] = useState("");
  const [error, setError] = useState("");
  const [exploreState, setExploreState] = useState<ExploreState>(initialExploreState);
  const [galleryMode, setGalleryModeState] = useState<GalleryMode>("flat");
  const navigationState = useRef({ activeView, galleryMode, galleryScope });
  const rememberGalleryPosition = useCallback(() => {
    const current = navigationState.current;
    if (current.activeView === "gallery" && mainRef.current) {
      if (current.galleryScope) {
        const registered = detailCapture.current;
        if (registered && galleryScopeKey(registered.scope) === galleryScopeKey(current.galleryScope)) {
          detailSessions.current!.patch(registered.scope, registered.capture());
        }
      } else {
        scrollPositions.current.set(`gallery:${current.galleryMode}`, mainRef.current.scrollTop);
      }
    }
  }, []);
  const setGalleryScope = useCallback((next: GalleryScope | null) => {
    if (galleryScopeKey(next) !== galleryScopeKey(navigationState.current.galleryScope)) rememberGalleryPosition();
    setGalleryScopeState(next);
  }, [rememberGalleryPosition]);
  const patchDetailSession = useCallback((scope: GalleryDetailScope, patch: GalleryDetailSessionPatch) => {
    const current = navigationState.current;
    if (current.activeView !== "gallery" || galleryScopeKey(scope) !== galleryScopeKey(current.galleryScope)) return;
    detailSessions.current!.patch(scope, patch);
    // Position writes stay in refs; only a controlled mode change needs a React render.
    if (patch.viewMode) setDetailRevision((revision) => revision + 1);
  }, []);
  const registerDetailCapture = useCallback((scope: GalleryDetailScope, capture: () => GalleryDetailSessionPatch) => {
    const registered = { scope, capture };
    detailCapture.current = registered;
    return () => { if (detailCapture.current === registered) detailCapture.current = null; };
  }, []);
  const setActiveView = useCallback((next: ActiveView) => {
    if (next !== navigationState.current.activeView) rememberGalleryPosition();
    if (next !== "explore") setProtectionOpen(false);
    setActiveViewState(next);
  }, [rememberGalleryPosition]);
  const setGalleryMode = useCallback((next: GalleryMode) => {
    if (next !== navigationState.current.galleryMode) {
      rememberGalleryPosition();
      setGalleryScopeState(null);
    }
    setGalleryModeState(next);
  }, [rememberGalleryPosition]);
  const [analysisWorkIds, setAnalysisWorkIds] = useState<string[]>([]);
  const [analysisTaskId, setAnalysisTaskId] = useState<string | null>(null);
  const [inspectorTarget, setInspectorTarget] = useState<ElementInspectorTarget | null>(null);
  const [discussionImportId, setDiscussionImportId] = useState<string | null>(null);
  const [discussionBusy, setDiscussionBusy] = useState(false);
  const [inspirationLaunch, setInspirationLaunch] = useState<{ workId: string; pageIndex: number; sources?: Array<{workId:string;pageIndex:number}> } | null>(null);
  const showError = useCallback((caught: unknown) => {
    setError(caught instanceof Error ? caught.message : "发生未知错误");
  }, []);
  const localImport = useLocalImport(async () => {
    await refreshLibrary();
    setThumbnailRevision((current) => current + 1);
    if (navigationState.current.activeView === "home") setActiveView("gallery");
  }, showError);
  const busy = localImport.choosing;
  blockingAppOverlay.current = Boolean(collectionEditor || bookmarkPreview || inspectorTarget || localImport.open || tasksOpen);
  const directory = useGalleryDirectory(galleryMode, galleryScope, activeView === "gallery", showError);
  const { refresh: refreshGalleryData, refreshDirectory } = directory;
  useEffect(() => {
    if (!galleryScope || directory.directoryLoading || directory.directoryReadyMode !== galleryMode) return;
    const exists = galleryScope.kind === "collection"
      ? directory.collectionSummaries.some((item) => item.id === galleryScope.collectionId)
      : galleryScope.kind === "artist"
        ? directory.artistSummaries.some((item) => item.artistId === galleryScope.artistId) : true;
    if (!exists) {
      // Reject unmount callbacks immediately; layout effects update the route ref later.
      if (galleryScopeKey(navigationState.current.galleryScope) !== galleryScopeKey(galleryScope)) return;
      if (galleryScopeKey(detailCapture.current?.scope ?? null) === galleryScopeKey(galleryScope)) detailCapture.current = null;
      navigationState.current = { ...navigationState.current, galleryScope: null };
      if (galleryScope.kind !== "work") detailSessions.current!.delete(galleryScope);
      setGalleryScopeState(null);
    }
  }, [galleryScope, galleryMode, directory.directoryLoading, directory.directoryReadyMode, directory.collectionSummaries, directory.artistSummaries]);
  const { query: workQuery, result: workResult, loading: workLoading,
    setQuery: setWorkQuery, refresh: refreshWorks, loadMore: loadMoreWorks } = useLibraryQuery(showError);
  const pictureSearch = useGalleryPictureSearch(workQuery,activeView === "gallery" && !tasksOpen);
  const normalSort = useRef<WorkSortSnapshot>({ sortBy: "savedAt", direction: "desc" });
  if (workQuery.sortBy !== "lastViewedAt") {
    normalSort.current = { sortBy: workQuery.sortBy ?? "savedAt", direction: workQuery.direction ?? "desc" };
  }
  const scrollKey = activeView === "gallery" ? `gallery:${galleryMode}` : activeView === "settings" ? `settings:${settingsSection}` : activeView;
  useLayoutEffect(() => { navigationState.current = { activeView, galleryMode, galleryScope }; }, [activeView, galleryMode, galleryScope]);
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    // Author details restore their main-list anchor after the range and DOM are ready.
    // Albums use nested theater scrollers, so their outer frame starts at the top.
    if (activeView === "gallery" && galleryScope) {
      if (galleryScope.kind === "collection") main.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    main.scrollTo({ top: activeView === "gallery" ? scrollPositions.current.get(scrollKey) ?? 0 : 0, behavior: "instant" });
  }, [scrollKey, galleryScope]);
  useEffect(() => {
    scrollPositions.current.set("gallery:flat", 0);
    if (activeView === "gallery" && galleryMode === "flat") mainRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [workQuery]);

  const openQuickActions = useCallback(() => {
    if (!blockingAppOverlay.current && !hasBlockingOverlay()) setQuickActionsOpen(true);
  }, []);
  useEffect(() => window.sanctuary.onQuickActionsRequested(() => {
    if (blockingAppOverlay.current || hasBlockingOverlay()) return;
    nativeQuickActions.current = true;
    openQuickActions();
  }), [openQuickActions]);
  useEffect(() => {
    if (!pendingSearchFocus || quickActionsOpen || activeView !== "gallery" || galleryMode !== "flat") return;
    const input = document.querySelector<HTMLInputElement>(".work-search input");
    if (input) { input.focus(); input.select(); setPendingSearchFocus(false); }
  }, [activeView, galleryMode, quickActionsOpen, workLoading, pendingSearchFocus]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || blockingAppOverlay.current || hasBlockingOverlay()) return;
      const key = event.key.toLowerCase();
      if (key === "k") { event.preventDefault(); openQuickActions(); }
      else if (key === "o" && !busy) { event.preventDefault(); void importImages(); }
      else if (key === "f" && activeView === "gallery" && galleryMode === "flat") {
        const input = document.querySelector<HTMLInputElement>(".work-search input");
        if (input) { event.preventDefault(); input.focus(); input.select(); }
      } else if (["0", "1", "2", "3", "4"].includes(key)) {
        event.preventDefault();
        setActiveView(({ "0": "home", "1": "gallery", "2": "explore", "3": "inspiration", "4": "settings" } as const)[key as "0" | "1" | "2" | "3" | "4"]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeView, busy, galleryMode, openQuickActions]);

  const refreshLibrary = useCallback(async (refreshGallery = true) => {
    const [, nextCollections, nextArtists, , nextStorage] = await Promise.all([
      refreshWorks(),
      window.sanctuary.listCollections(),
      window.sanctuary.listArtists(),
      refreshGallery ? refreshGalleryData() : Promise.resolve(),
      window.sanctuary.getStorageLocation()
    ]);
    setCollections(nextCollections);
    setArtists(nextArtists);
    setStorageLocation(nextStorage);
  }, [refreshWorks, refreshGalleryData]);

  useEffect(() => {
    const returned = activeView === "gallery" && previousView.current !== "gallery";
    previousView.current = activeView;
    // Native Pixiv page controls can save works without a renderer-side download callback.
    // Revalidate the retained range on every route back, including shortcuts and search actions.
    if (returned) void refreshLibrary(false).catch(showError);
  }, [activeView, refreshLibrary, showError]);

  useEffect(() => {
    return window.sanctuary.onAppStatus(setStatus);
  }, []);
  useEffect(() => window.sanctuary.onExploreState((next) => setExploreState((current) =>
    navigationState.current.activeView === "explore" || JSON.stringify(current.download) !== JSON.stringify(next.download) ? next : current)), []);

  useEffect(() => {
    // 动态主题热注入
    window.sanctuary.getActiveTheme()
      .then((active) => applyThemeCss(active.cssContent))
      .catch(showError);

    const unsubTheme = window.sanctuary.onThemeChanged((event) => {
      applyThemeCss(event.cssContent);
    });
    const unsubInspector = window.sanctuary.onExploreOpenInspector((data) => {
      setProtectionOpen(false);
      setInspectorTarget(data);
    });

    void Promise.all([
      window.sanctuary.listCollections(),
      window.sanctuary.listFilterSettings(),
      window.sanctuary.status(),
      window.sanctuary.listArtists(),
      window.sanctuary.getAppearancePreferences(),
      window.sanctuary.getLibraryPreferences(),
      window.sanctuary.listCustomElementGroups(),
      window.sanctuary.getStorageLocation()
    ])
      .then(([nextCollections, nextFilterSettings, nextStatus, nextArtists, nextAppearance, nextLibraryPreferences, nextCustomGroups, nextStorage]) => {
        setCollections(nextCollections);
        setFilterSettings(nextFilterSettings);
        setStatus(nextStatus);
        setArtists(nextArtists);
        setAppearance(nextAppearance);
        setLibraryPreferences(nextLibraryPreferences);
        setCustomElementGroups(nextCustomGroups);
        setStorageLocation(nextStorage);
        setGalleryMode(nextLibraryPreferences.defaultView);
        setWorkQuery((current) => ({
          ...current,
          sortBy: nextLibraryPreferences.defaultSortBy,
          direction: nextLibraryPreferences.defaultSortDirection,
          offset: 0
        }));
      })
      .catch(showError);

    return () => {
      unsubTheme();
      unsubInspector();
    };
  }, []);

  useEffect(() => {
    if (activeView === "explore" && inspectorTarget && exploreState.artworkId && /^\d+$/.test(exploreState.artworkId)) {
      if (inspectorTarget.artworkId !== exploreState.artworkId) {
        setInspectorTarget({ artworkId: exploreState.artworkId });
      }
    }
  }, [activeView, exploreState.artworkId, inspectorTarget]);

  useEffect(() => {
    let active = true;
    const activity: ThumbnailActivity = { ...INITIAL_THUMBNAIL_ACTIVITY, phase: "running", limited: true };
    const failedAssets = new Set<string>();
    setThumbnailActivity({ ...activity });
    void (async () => {
      let changed = false;
      for (let batch = 0; batch < 80 && active; batch += 1) {
        await waitForRendererIdle();
        if (!active) return;
        const result = await window.sanctuary.generateThumbnails();
        if (!active) return;
        activity.generated += result.generated;
        activity.reused += result.reused;
        result.failedAssetIds.forEach((id) => failedAssets.add(id));
        activity.failed = failedAssets.size;
        if (batch === 0 || batch % 10 === 0) setThumbnailActivity({ ...activity });
        changed ||= result.generated + result.reused > 0;
        if (!active) return;
        if (changed && (batch === 0 || batch % 10 === 0)) {
          await refreshWorks();
          changed = false;
        }
        if (result.attempted < 6 || result.generated + result.reused === 0) { activity.limited = false; break; }
        await new Promise((resolveTask) => window.setTimeout(resolveTask, 120));
      }
      if (active && changed) await refreshWorks();
      if (active) await refreshDirectory();
      if (active) setThumbnailActivity({ ...activity, phase: activity.failed ? activity.generated + activity.reused > 0 ? "partial" : "failed" : "completed",
        message: activity.failed ? "有图片补图失败，请检查文件后重新尝试。" : activity.limited ? "补图分轮处理，以保持操作流畅。可继续检查下一轮。" : "本轮补图已结束。" });
    })().catch((cause) => {
      if (active) { setThumbnailActivity({ ...activity, phase: "failed", message: "补图未完成，可检查图片文件后重新尝试。" }); showError(cause); }
    });
    return () => {
      active = false;
    };
  }, [refreshWorks, refreshDirectory, showError, thumbnailRevision]);

  async function importImages() {
    setError("");
    await localImport.choose();
  }

  async function saveCollection(draft: CollectionDraft) {
    setCollectionSaving(true);
    try {
      setCollections(collectionEditor === "new"
        ? await window.sanctuary.createCollection(draft)
        : await window.sanctuary.updateCollection(collectionEditor?.id ?? "", draft));
      setCollectionEditor(null);
      await refreshGalleryData();
    } catch (caught) {
      showError(caught);
    } finally {
      setCollectionSaving(false);
    }
  }

  async function saveSavedCollectionView(draft: SavedCollectionViewDraft, id?: string) {
    try {
      if (id) {
        await window.sanctuary.updateSavedCollectionView(id, draft);
      } else {
        await window.sanctuary.createSavedCollectionView(draft);
      }
      await refreshDirectory();
    } catch (caught) {
      showError(caught);
      throw caught;
    }
  }

  async function deleteSavedCollectionView(id: string) {
    try {
      await window.sanctuary.deleteSavedCollectionView(id);
      await refreshDirectory();
    } catch (caught) {
      showError(caught);
    }
  }

  async function deleteEditedCollection() {
    if (!collectionEditor || collectionEditor === "new") return;
    setCollectionSaving(true);
    try {
      setCollections(await window.sanctuary.deleteCollection(collectionEditor.id));
      setCollectionEditor(null);
      await refreshWorks();
      await refreshGalleryData();
    } catch (caught) {
      showError(caught);
    } finally {
      setCollectionSaving(false);
    }
  }

  async function assignCollection(artworkId: string, collectionId: string) {
    if (!collectionId) return;
    try { await addCollectionArtworks([artworkId], collectionId); }
    catch (caught) { showError(caught); }
  }

  async function addCollectionArtworks(artworkIds: string[], collectionId: string) {
    await window.sanctuary.addArtworksToCollection(artworkIds, collectionId);
    await Promise.all([refreshWorks(), refreshGalleryData()]);
  }

  async function assignWorkCollection(workId: string, collectionId: string) {
    if (!collectionId) return;
    await window.sanctuary.addWorkToCollection(workId, collectionId);
    await refreshWorks();
    await refreshGalleryData();
  }

  async function updateCollectionCover(collectionId: string, artworkId: string | null) {
    try {
      setCollections(await window.sanctuary.updateCollectionCover(collectionId, artworkId));
      await refreshDirectory();
    } catch (caught) {
      showError(caught);
    }
  }

  async function repairArtistAvatars() {
    setRepairingAvatars(true);
    setAvatarRepairMessage("");
    setError("");
    try {
      const result = await window.sanctuary.repairArtistAvatars();
      await refreshLibrary();
      const parts = [`补全 ${result.repairedArtists}`];
      if (result.alreadyPresentArtists > 0) parts.push(`已有 ${result.alreadyPresentArtists}`);
      if (result.unavailableArtists > 0) parts.push(`无自定义头像 ${result.unavailableArtists}`);
      if (result.failedArtists > 0) parts.push(`失败 ${result.failedArtists}`);
      setAvatarRepairMessage(parts.join(" · "));
      if (result.lastFailure) setError(`头像补全未全部完成：${result.lastFailure}`);
    } catch (caught) {
      showError(caught);
    } finally {
      setRepairingAvatars(false);
    }
  }

  async function openGallery() {
    setActiveView("gallery");
  }

  function openSettings(section: SettingsSection) {
    if (section === "protection") { openProtection(); return; }
    setSettingsSection(section);
    setActiveView("settings");
  }

  function openProtection() {
    setInspectorTarget(null);
    setProtectionOpen(true);
    setActiveView("explore");
  }
  const closeProtection = useCallback(() => {
    nativeFocusPending.current = true;
    setProtectionOpen(false);
  }, []);
  async function updateCustomGroups(groups: CustomElementGroup[]) {
    setCustomElementGroups(await window.sanctuary.updateCustomElementGroups(groups));
    setFilterSettings(await window.sanctuary.listFilterSettings());
  }

  async function changeGalleryMode(mode: GalleryMode) {
    setGalleryMode(mode);
  }

  function openWorkPreset(preset: WorkPreset) {
    setGalleryMode("flat");
    setActiveView("gallery");
    setWorkQuery((current) => {
      const { search: _search, workType: _workType, artistId: _artistId, unattributed: _unattributed, ...withoutSearch } = current;
      return applyWorkPreset(clearWorkCollectionFilters(withoutSearch), preset, normalSort.current);
    });
  }

  async function downloadCurrentArtwork() {
    setError("");
    try {
      await window.sanctuary.downloadCurrentArtwork();
      await refreshLibrary();
    } catch (caught) {
      showError(caught);
    }
  }

  async function previewAllBookmarks() {
    setError("");
    try {
      const preview = await window.sanctuary.previewBookmarkDownload();
      if (preview.total === 0) {
        setError("这个收藏页中没有可下载的作品。");
        return;
      }
      setBookmarkPreview(preview);
    } catch (caught) {
      showError(caught);
    }
  }

  async function confirmBookmarkDownload() {
    setStartingBookmarkDownload(true);
    setError("");
    try {
      await window.sanctuary.downloadAllBookmarks();
      setBookmarkPreview(null);
      await refreshLibrary();
    } catch (caught) {
      showError(caught);
    } finally {
      setStartingBookmarkDownload(false);
    }
  }

  const downloadBusy = exploreState.download.phase === "discovering" ||
    exploreState.download.phase === "downloading";

  async function updateAppearance(next: AppearancePreferences) {
    setAppearance(next);
    try {
      setAppearance(await window.sanctuary.updateAppearancePreferences(next));
    } catch (caught) {
      setAppearance(appearance);
      showError(caught);
    }
  }

  async function updateLibraryPreferences(next: LibraryPreferences) {
    setLibraryPreferences(next);
    try {
      const stored = await window.sanctuary.updateLibraryPreferences(next);
      setLibraryPreferences(stored);
    } catch (caught) {
      showError(caught);
    }
  }

  const quickActions: QuickAction[] = [
    { id: "tasks", label: "任务与进度", description: "查看导入、下载、补图与批量识别", keywords: ["任务", "进度", "失败", "重试"], onSelect: () => setTasksOpen(true) },
    { id: "home", label: "回到开始", description: "选择今天想做的事", shortcut: "Ctrl 0", keywords: ["首页", "引导"], onSelect: () => setActiveView("home") },
    { id: "gallery", label: "打开图库", description: "继续浏览刚才的位置", shortcut: "Ctrl 1", keywords: ["浏览", "作品"], onSelect: openGallery },
    { id: "favorites", label: "喜欢的作品", description: "浏览图库中标记喜欢的作品", keywords: ["收藏", "喜爱"], onSelect: () => openWorkPreset("favorites") },
    { id: "recent", label: "最近浏览", description: "找到看过的作品，继续上次阅读", keywords: ["历史", "继续", "阅读"], onSelect: () => openWorkPreset("recent") },
    { id: "uncollected", label: "未分相册", description: "找出还没有加入任何相册的作品", keywords: ["整理", "分类"], onSelect: () => openWorkPreset("uncollected") },
    { id: "search", label: "搜索图库", description: "用中文描述画面找图，也可搜名称和画师", shortcut: "Ctrl F", keywords: ["查找"], onSelect: () => {
      setPendingSearchFocus(true); setActiveView("gallery"); void changeGalleryMode("flat");
    } },
    { id: "import", label: "导入本地图片", description: "将图片加入图库", shortcut: "Ctrl O", disabled: busy, disabledReason: "正在导入，请稍候", keywords: ["添加", "文件"], onSelect: importImages },
    { id: "albums", label: "浏览相册", description: "管理相册与组合视图", keywords: ["分类", "画集"], onSelect: () => { setActiveView("gallery"); void changeGalleryMode("collections"); } },
    { id: "organize", label: "找图与整理", description: "从图库或文件夹找图，复制、导入或加入相册", keywords: ["分析", "标签", "分类"], onSelect: () => { setAnalysisWorkIds([]); setActiveView("organize"); } },
    { id: "explore", label: "打开探索", description: "浏览 Pixiv 并保存作品", shortcut: "Ctrl 2", keywords: ["下载", "收藏"], onSelect: () => setActiveView("explore") },
    { id: "protection", label: "浏览保护", description: "在探索调整拦截内容与识别模型", keywords: ["规则", "过滤", "阈值"], onSelect: openProtection },
    { id: "creation", label: "打开创作", description: "聊图、写设定与提示词", shortcut: "Ctrl 3", keywords: ["对话", "写作"], onSelect: () => setActiveView("inspiration") },
    { id: "settings", label: "打开设置", description: "管理图库与存储", shortcut: "Ctrl 4", onSelect: () => openSettings("library") },
    { id: "models", label: "本地模型", description: "安装或切换识别、画评与创作模型", keywords: ["安装", "AI"], onSelect: () => openSettings("models") },
    { id: "appearance", label: "外观与显示", description: "主题、字体与显示性能", keywords: ["换肤", "流畅", "省电"], onSelect: () => openSettings("appearance") }
  ];

  return (
    <div
      className={`app-shell ${activeView === "explore" ? "exploring" : ""}`}
      onClickCapture={(event) => animateButtonClick(event.target)}
      data-display-profile={appearance.displayProfile}
      data-reduced-motion={appearance.reducedMotion ? "true" : "false"}
      data-ambient-artwork={appearance.ambientArtwork ? "true" : "false"}
      data-grid-density={libraryPreferences.gridDensity}
    >
      <AppSidebar
        activeView={activeView}
        exploreState={exploreState}
        downloadBusy={downloadBusy}
        appearance={appearance}
        status={status}
        storageLocation={storageLocation}
        onOpenGallery={openGallery}
        onQuickActions={openQuickActions}
        onOpenTasks={() => setTasksOpen(true)}
        taskCount={activeTaskCount(localImport.batch, exploreState.download, thumbnailActivity, analysisTasks.jobs)+analysisTasks.images.filter(t=>["running","scanning","analyzing"].includes(t.phase)).length}
        onViewChange={setActiveView}
        onDownloadCurrentArtwork={downloadCurrentArtwork}
        onPreviewBookmarks={previewAllBookmarks}
        onOpenSettings={openSettings}
        onChooseDownloadDirectory={async () => {
          try {
            const res = await window.sanctuary.chooseDownloadDirectory();
            setLibraryPreferences(res.preferences);
            setStorageLocation(res.location);
            await refreshLibrary();
          } catch (caught) { showError(caught); }
        }}
        onOpenStorageDirectory={async () => {
          await window.sanctuary.openStorageDirectory();
        }}
      />

      <main ref={mainRef} className="animate-fade-in" onScroll={(event) => {
        if (activeView === "gallery" && !galleryScope) scrollPositions.current.set(scrollKey, event.currentTarget.scrollTop);
      }}>
        {(activeView === "gallery" || activeView === "organize") && (
          <nav className="workspace-navigation" aria-label="图库工作区">
            <button type="button" data-nav="browse" aria-current={activeView === "gallery" ? "page" : undefined} onClick={() => void openGallery()}>浏览作品</button>
            <button type="button" data-nav="organize" aria-current={activeView === "organize" ? "page" : undefined} onClick={() => {
              if (activeView === "organize") return;
              setAnalysisWorkIds([]);
              setActiveView("organize");
            }}>整理与分类</button>
          </nav>
        )}
        <Suspense fallback={<section className="page-loading" role="status">正在打开…</section>}>
        {activeView === "home" ? (
          <>
          {error && <AppNotice tone="error">{error}</AppNotice>}
          <HomeView workCount={workResult.total} importing={busy} onImport={importImages}
            onSelect={(destination: HomeDestination) => {
              if (destination === "gallery") { void openGallery(); return; }
              if (destination === "organize") setAnalysisWorkIds([]);
              setActiveView(destination);
            }} />
          </>
        ) : activeView === "gallery" ? (
          <GalleryView
            pictureSearch={pictureSearch}
            collectionSummaries={directory.collectionSummaries}
            artistSummaries={directory.artistSummaries}
            artistCount={artists.length}
            savedViewSummaries={directory.savedViewSummaries}
            savedViewsTotal={directory.savedViewsTotal}
            savedViewsHasMore={directory.savedViewsHasMore}
            directoryLoading={directory.directoryLoading}
            onRetryDirectory={() => { setError(""); void refreshGalleryData().catch(showError); }}
            savedViewsLoading={directory.savedViewsLoading}
            onLoadMoreSavedViews={() => void directory.loadMoreSavedViews()}
            scope={galleryScope}
            scopedArtworks={directory.scopedArtworks}
            scopeLoading={directory.scopeLoading}
            onScopeChange={setGalleryScope}
            detailSession={galleryScope && galleryScope.kind !== "work" ? detailSessions.current.read(galleryScope) : null}
            onDetailSessionChange={patchDetailSession}
            mainScrollRef={mainRef}
            onRegisterDetailCapture={registerDetailCapture}
            workResult={workResult}
            workQuery={workQuery}
            normalSort={normalSort.current}
            workLoading={workLoading}
            collections={collections}
            appearance={appearance}
            mode={galleryMode}
            busy={busy}
            repairingAvatars={repairingAvatars}
            avatarRepairMessage={avatarRepairMessage}
            error={error}
            onImport={importImages}
            onOpenExplore={() => setActiveView("explore")}
            onCreateCollection={() => setCollectionEditor("new")}
            onEditCollection={setCollectionEditor}
            onSaveSavedView={saveSavedCollectionView}
            onDeleteSavedView={deleteSavedCollectionView}
            onAssignCollection={assignCollection}
            onAddCollectionArtworks={addCollectionArtworks}
            onAssignWorkCollection={assignWorkCollection}
            onUpdateCollectionCover={updateCollectionCover}
            onRepairArtistAvatars={repairArtistAvatars}
            onModeChange={(nextMode) => void changeGalleryMode(nextMode)}
            onWorkQueryChange={setWorkQuery}
            onLoadMoreWorks={() => void loadMoreWorks()}
            onWorkLibraryChanged={() => refreshLibrary()}
            onAnalyzeWorks={(workIds) => {
              setAnalysisWorkIds(workIds);
              setActiveView("organize");
            }}
            onOpenInspiration={(workId, pageIndex) => {
              setInspirationLaunch({ workId, pageIndex });
              setActiveView("inspiration");
            }}
            onOpenPixivArtist={(artistId) => {
              setActiveView("explore");
              void window.sanctuary.openPixivArtist(artistId)
                .then(setExploreState)
                .catch((caught) => {
                  setActiveView("gallery");
                  showError(caught);
                });
            }}
            onError={showError}
          />
        ) : activeView === "organize" ? (
          <AnalysisView
            initialWorkbenchSource={workbenchSource}
            onWorkbenchOpened={()=>setWorkbenchSource(null)}
            onImportPrepared={(batch,discuss) => { localImport.adopt(batch); setDiscussionImportId(discuss ? batch.id : null); }}
            onDiscuss={async targets => {
              const sources = await window.sanctuary.prepareInspirationTargets(targets);
              if (!sources[0]) throw new Error("请选择参考图");
              setInspirationLaunch({...sources[0], sources}); setActiveView("inspiration");
            }}
            initialJobId={analysisTaskId}
            onJobOpened={() => setAnalysisTaskId(null)}
            collections={collections}
            artists={artists}
            selectedWorkIds={analysisWorkIds}
            status={status}
            error={error}
            onApplied={refreshLibrary}
            onOpenProtection={openProtection}
            onRulesChanged={async () => {
              const [settings, groups] = await Promise.all([window.sanctuary.listFilterSettings(), window.sanctuary.listCustomElementGroups()]);
              setFilterSettings(settings); setCustomElementGroups(groups);
            }}
            onError={showError}
          />
        ) : activeView === "inspiration" ? (
          <>
          {error && <AppNotice tone="error">{error}</AppNotice>}
          <InspirationView
            launch={inspirationLaunch}
            onLaunchConsumed={() => setInspirationLaunch(null)}
            onOpenModelCenter={() => openSettings("models")}
          />
          </>
        ) : activeView === "settings" ? (
          <SettingsView
            section={settingsSection}
            onSectionChange={setSettingsSection}
            onError={showError}
            appearance={appearance}
            libraryPreferences={libraryPreferences}
            error={error}
            storageLocation={storageLocation}
            onOpenProtection={openProtection}
            modelBusy={protectionBusy}
            onModelBusyChange={setProtectionBusy}
            onAppearanceChange={updateAppearance}
            onLibraryPreferencesChange={updateLibraryPreferences}
            onChooseDownloadDirectory={async () => {
              const res = await window.sanctuary.chooseDownloadDirectory();
              setLibraryPreferences(res.preferences);
              setStorageLocation(res.location);
              await refreshLibrary();
              return res;
            }}
            onOpenStorageDirectory={async () => window.sanctuary.openStorageDirectory()}
            onMigrateStorage={async () => {
              const res = await window.sanctuary.migrateStorage();
              setStorageLocation(await window.sanctuary.getStorageLocation());
              await refreshLibrary();
              return res;
            }}
            onCreateBackup={async () => {
              try { return await window.sanctuary.createLibraryBackup(); }
              catch (caught) { showError(caught); return null; }
            }}
          />
        ) : (
          <ExploreView
            state={exploreState}
            error={error}
            isDrawerOpen={Boolean(inspectorTarget)}
            isModalOpen={Boolean(bookmarkPreview || collectionEditor || quickActionsOpen || localImport.open || tasksOpen)}
            focusOnShow={nativeFocusPending.current}
            onFocusRestored={() => { nativeFocusPending.current = false; }}
            protectionOpen={protectionOpen}
            onProtectionOpen={openProtection}
            onProtectionClose={closeProtection}
            protectionPanel={protectionOpen && <Suspense fallback={<aside className="explore-protection-panel">正在读取保护设置…</aside>}>
              <ExploreProtectionPanel state={exploreState} status={status} settings={filterSettings} customGroups={customElementGroups}
                busy={protectionBusy} onBusyChange={setProtectionBusy}
                onReloadPage={async () => { setExploreState(await window.sanctuary.exploreCommand("reload")); }}
                onSettingsChange={setFilterSettings} onCustomGroupsChange={updateCustomGroups} onClose={closeProtection} />
            </Suspense>}
            onStateChange={setExploreState}
            onError={showError}
          />
        )}
        </Suspense>
      </main>
      <Suspense fallback={null}>
      {tasksOpen && <TaskCenter batch={localImport.batch} download={exploreState.download} thumbnails={thumbnailActivity}
        jobs={analysisTasks.jobs} images={analysisTasks.images} loading={analysisTasks.loading} error={analysisTasks.error} onRefresh={analysisTasks.refresh}
        onImageTask={(source,gallerySearch)=>{if(gallerySearch){setTasksOpen(false);setGalleryMode("flat");setActiveView("gallery");return;}setTasksOpen(false);setAnalysisWorkIds([]);setAnalysisTaskId(null);setWorkbenchSource(source);setActiveView("organize");}}
        onImport={() => { setTasksOpen(false); localImport.show(); }}
        onExplore={() => { setTasksOpen(false); nativeFocusPending.current = true; setActiveView("explore"); }}
        onOrganize={(id) => { setTasksOpen(false); setAnalysisWorkIds([]); setAnalysisTaskId(id); setActiveView("organize"); }}
        onOpenStorage={() => window.sanctuary.openStorageDirectory()} onRetryThumbnails={() => setThumbnailRevision((value) => value + 1)}
        onClose={() => { setTasksOpen(false); if (navigationState.current.activeView === "explore") nativeFocusPending.current = true; }} />}
      {localImport.open && localImport.batch && <ImportImagesDialog key={localImport.batch.id} batch={localImport.batch} collections={collections}
        busy={localImport.commandBusy || discussionBusy} error={localImport.error} onCommand={localImport.command} onClose={localImport.close}
        onDiscuss={discussionImportId === localImport.batch.id ? () => {
          if(discussionBusy)return;setDiscussionBusy(true);
          void window.sanctuary.importInspirationSources(localImport.batch!.id).then(sources => {
            if(!sources[0])throw new Error("没有成功导入的图片");
            setInspirationLaunch({...sources[0],sources});setDiscussionImportId(null);localImport.close();setActiveView("inspiration");
          }).catch(showError).finally(()=>setDiscussionBusy(false));
        } : undefined} />}
      {inspectorTarget && (
        <ElementInspectorDrawer
          target={inspectorTarget}
          onClose={() => setInspectorTarget(null)}
          onBlacklistUpdated={(groups) => setCustomElementGroups(groups)}
          onGenerated={refreshLibrary}
        />
      )}
      {collectionEditor && (
        <CollectionEditor
          collection={collectionEditor === "new" ? null : collectionEditor}
          saving={collectionSaving}
          onSave={saveCollection}
          onDelete={collectionEditor === "new" ? null : deleteEditedCollection}
          onClose={() => !collectionSaving && setCollectionEditor(null)}
        />
      )}
      {bookmarkPreview && (
        <BookmarkDownloadDialog
          preview={bookmarkPreview}
          busy={startingBookmarkDownload}
          onConfirm={confirmBookmarkDownload}
          onClose={() => !startingBookmarkDownload && setBookmarkPreview(null)}
        />
      )}
      </Suspense>
      {quickActionsOpen && <QuickActions actions={quickActions} onClose={(reason) => {
        nativeFocusPending.current = nativeQuickActions.current && reason !== "execute";
        nativeQuickActions.current = false;
        setQuickActionsOpen(false);
      }} onError={showError} />}
    </div>
  );
}

function applyThemeCss(cssContent: string): void {
  const style =
    document.querySelector<HTMLStyleElement>("#ds-dynamic-theme") ??
    document.head.appendChild(document.createElement("style"));
  style.id = "ds-dynamic-theme";
  style.textContent = cssContent;
}

function waitForRendererIdle(): Promise<void> {
  return new Promise((resolveTask) => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolveTask(), { timeout: 800 });
      return;
    }
    globalThis.setTimeout(resolveTask, 80);
  });
}

function hasBlockingOverlay(): boolean {
  return Boolean(document.querySelector('.dialog-overlay, .cinema-lightbox-theater, [role="dialog"][aria-modal="true"], .element-inspector-drawer'));
}
