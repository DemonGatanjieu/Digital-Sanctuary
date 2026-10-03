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
import type { BookmarkDownloadPreview } from "../../shared/pixiv-download.js";
import { useLibraryQuery } from "./useLibraryQuery";
import { useGalleryDirectory } from "./useGalleryDirectory";
import { QuickActions, type QuickAction } from "./QuickActions";
import { AppNotice } from "./AppNotice";
import { applyWorkPreset, clearWorkCollectionFilters, type WorkPreset, type WorkSortSnapshot } from "./work-presets";

const SettingsView = lazy(() => import("./SettingsView").then((module) => ({ default: module.SettingsView })));
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
  const [activeView, setActiveViewState] = useState<ActiveView>("gallery");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("library");
  const mainRef = useRef<HTMLElement>(null);
  const [galleryScope, setGalleryScope] = useState<GalleryScope | null>(null);
  const [thumbnailRevision, setThumbnailRevision] = useState(0);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [pendingSearchFocus, setPendingSearchFocus] = useState(false);
  const nativeQuickActions = useRef(false);
  const nativeFocusPending = useRef(false);
  const blockingAppOverlay = useRef(false);
  const scrollPositions = useRef(new Map<string, number>());
  const previousView = useRef<ActiveView>("gallery");
  const [collectionEditor, setCollectionEditor] = useState<CollectionRecord | "new" | null>(null);
  const [collectionSaving, setCollectionSaving] = useState(false);
  const [appearance, setAppearance] = useState<AppearancePreferences>(DEFAULT_APPEARANCE);
  const [libraryPreferences, setLibraryPreferences] = useState<LibraryPreferences>(DEFAULT_LIBRARY_PREFERENCES);
  const [storageLocation, setStorageLocation] = useState<StorageLocationInfo | null>(null);
  const [customElementGroups, setCustomElementGroups] = useState<CustomElementGroup[]>([]);
  const [bookmarkPreview, setBookmarkPreview] = useState<BookmarkDownloadPreview | null>(null);
  const [startingBookmarkDownload, setStartingBookmarkDownload] = useState(false);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [artists, setArtists] = useState<ArtistRecord[]>([]);
  const [filterSettings, setFilterSettings] = useState<ElementFilterSetting[]>([]);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [repairingAvatars, setRepairingAvatars] = useState(false);
  const [avatarRepairMessage, setAvatarRepairMessage] = useState("");
  const [savingGroupId, setSavingGroupId] = useState("");
  const [error, setError] = useState("");
  const [exploreState, setExploreState] = useState<ExploreState>(initialExploreState);
  const [galleryMode, setGalleryModeState] = useState<GalleryMode>("flat");
  const navigationState = useRef({ activeView, galleryMode });
  const rememberGalleryPosition = useCallback(() => {
    const current = navigationState.current;
    if (current.activeView === "gallery" && mainRef.current) {
      scrollPositions.current.set(`gallery:${current.galleryMode}`, mainRef.current.scrollTop);
    }
  }, []);
  const setActiveView = useCallback((next: ActiveView) => {
    if (next !== navigationState.current.activeView) rememberGalleryPosition();
    setActiveViewState(next);
  }, [rememberGalleryPosition]);
  const setGalleryMode = useCallback((next: GalleryMode) => {
    if (next !== navigationState.current.galleryMode) {
      rememberGalleryPosition();
      setGalleryScope(null);
    }
    setGalleryModeState(next);
  }, [rememberGalleryPosition]);
  const [analysisWorkIds, setAnalysisWorkIds] = useState<string[]>([]);
  const [inspectorTarget, setInspectorTarget] = useState<ElementInspectorTarget | null>(null);
  const [inspirationLaunch, setInspirationLaunch] = useState<{ workId: string; pageIndex: number } | null>(null);
  const showError = useCallback((caught: unknown) => {
    setError(caught instanceof Error ? caught.message : "发生未知错误");
  }, []);
  blockingAppOverlay.current = Boolean(collectionEditor || bookmarkPreview || inspectorTarget);
  const directory = useGalleryDirectory(galleryMode, galleryScope, activeView === "gallery", showError);
  const { refresh: refreshGalleryData, refreshDirectory } = directory;
  useEffect(() => {
    if (!galleryScope || directory.directoryLoading || directory.directoryReadyMode !== galleryMode) return;
    const exists = galleryScope.kind === "collection"
      ? directory.collectionSummaries.some((item) => item.id === galleryScope.collectionId)
      : galleryScope.kind === "artist"
        ? directory.artistSummaries.some((item) => item.artistId === galleryScope.artistId) : true;
    if (!exists) setGalleryScope(null);
  }, [galleryScope, galleryMode, directory.directoryLoading, directory.directoryReadyMode, directory.collectionSummaries, directory.artistSummaries]);
  const { query: workQuery, result: workResult, loading: workLoading,
    setQuery: setWorkQuery, refresh: refreshWorks, loadMore: loadMoreWorks } = useLibraryQuery(showError);
  const normalSort = useRef<WorkSortSnapshot>({ sortBy: "savedAt", direction: "desc" });
  if (workQuery.sortBy !== "lastViewedAt") {
    normalSort.current = { sortBy: workQuery.sortBy ?? "savedAt", direction: workQuery.direction ?? "desc" };
  }
  const scrollKey = activeView === "gallery" ? `gallery:${galleryMode}` : activeView === "settings" ? `settings:${settingsSection}` : activeView;
  useLayoutEffect(() => { navigationState.current = { activeView, galleryMode }; }, [activeView, galleryMode]);
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.scrollTo({ top: activeView === "gallery" ? scrollPositions.current.get(scrollKey) ?? 0 : 0, behavior: "instant" });
  }, [scrollKey]);
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
      } else if (["1", "2", "3", "4"].includes(key)) {
        event.preventDefault();
        setActiveView(({ "1": "gallery", "2": "explore", "3": "inspiration", "4": "settings" } as const)[key as "1" | "2" | "3" | "4"]);
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

  useEffect(() => {
    // 动态主题热注入
    window.sanctuary.getActiveTheme()
      .then((active) => applyThemeCss(active.cssContent))
      .catch(showError);

    const unsubTheme = window.sanctuary.onThemeChanged((event) => {
      applyThemeCss(event.cssContent);
    });
    const unsubInspector = window.sanctuary.onExploreOpenInspector((data) => {
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
    void (async () => {
      let changed = false;
      for (let batch = 0; batch < 80 && active; batch += 1) {
        await waitForRendererIdle();
        if (!active) return;
        const result = await window.sanctuary.generateThumbnails();
        changed ||= result.generated + result.reused > 0;
        if (!active) return;
        if (changed && (batch === 0 || batch % 10 === 0)) {
          await refreshWorks();
          changed = false;
        }
        if (result.attempted < 6 || result.generated + result.reused === 0) break;
        await new Promise((resolveTask) => window.setTimeout(resolveTask, 120));
      }
      if (active && changed) await refreshWorks();
      if (active) await refreshDirectory();
    })().catch(showError);
    return () => {
      active = false;
    };
  }, [refreshWorks, refreshDirectory, showError, thumbnailRevision]);

  async function importImages() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await window.sanctuary.importImages();
      await refreshLibrary();
      setThumbnailRevision((current) => current + 1);
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
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

  function editFilterSetting(next: ElementFilterSetting) {
    setFilterSettings((current) =>
      current.map((setting) => (setting.groupId === next.groupId ? next : setting))
    );
  }

  async function saveFilterSetting(setting: ElementFilterSetting) {
    setSavingGroupId(setting.groupId);
    setError("");
    try {
      setFilterSettings(await window.sanctuary.updateFilterSetting(setting));
    } catch (caught) {
      showError(caught);
    } finally {
      setSavingGroupId("");
    }
  }

  async function openGallery() {
    setActiveView("gallery");
  }

  function openSettings(section: SettingsSection) {
    setSettingsSection(section);
    setActiveView("settings");
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
    { id: "gallery", label: "打开图库", description: "继续浏览刚才的位置", shortcut: "Ctrl 1", keywords: ["浏览", "作品"], onSelect: openGallery },
    { id: "favorites", label: "喜欢的作品", description: "浏览图库中标记喜欢的作品", keywords: ["收藏", "喜爱"], onSelect: () => openWorkPreset("favorites") },
    { id: "recent", label: "最近浏览", description: "找到看过的作品，继续上次阅读", keywords: ["历史", "继续", "阅读"], onSelect: () => openWorkPreset("recent") },
    { id: "uncollected", label: "未分相册", description: "找出还没有加入任何相册的作品", keywords: ["整理", "分类"], onSelect: () => openWorkPreset("uncollected") },
    { id: "search", label: "搜索图库", description: "按标题、画师或 Pixiv ID 找作品", shortcut: "Ctrl F", keywords: ["查找"], onSelect: () => {
      setPendingSearchFocus(true); setActiveView("gallery"); void changeGalleryMode("flat");
    } },
    { id: "import", label: "导入本地图片", description: "将图片加入图库", shortcut: "Ctrl O", disabled: busy, disabledReason: "正在导入，请稍候", keywords: ["添加", "文件"], onSelect: importImages },
    { id: "albums", label: "浏览相册", description: "管理相册与组合视图", keywords: ["分类", "画集"], onSelect: () => { setActiveView("gallery"); void changeGalleryMode("collections"); } },
    { id: "organize", label: "整理与分类", description: "按标签查找、推荐相册分类", keywords: ["分析", "标签"], onSelect: () => { setAnalysisWorkIds([]); setActiveView("organize"); } },
    { id: "explore", label: "打开探索", description: "浏览 Pixiv 并保存作品", shortcut: "Ctrl 2", keywords: ["下载", "收藏"], onSelect: () => setActiveView("explore") },
    { id: "creation", label: "打开创作", description: "聊图、写设定与提示词", shortcut: "Ctrl 3", keywords: ["对话", "写作"], onSelect: () => setActiveView("inspiration") },
    { id: "settings", label: "打开设置", description: "管理图库与存储", shortcut: "Ctrl 4", onSelect: () => openSettings("library") },
    { id: "models", label: "本地模型", description: "安装或切换识别、画评与创作模型", keywords: ["安装", "AI"], onSelect: () => openSettings("models") },
    { id: "appearance", label: "外观与显示", description: "主题、字体与显示性能", keywords: ["换肤", "流畅", "省电"], onSelect: () => openSettings("appearance") }
  ];

  return (
    <div
      className={`app-shell ${activeView === "explore" ? "exploring" : ""}`}
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
        onViewChange={setActiveView}
        onDownloadCurrentArtwork={downloadCurrentArtwork}
        onPreviewBookmarks={previewAllBookmarks}
        onOpenSettings={openSettings}
        onChooseDownloadDirectory={async () => {
          const res = await window.sanctuary.chooseDownloadDirectory();
          setLibraryPreferences(res.preferences);
          setStorageLocation(res.location);
          await refreshLibrary();
        }}
        onOpenStorageDirectory={async () => {
          await window.sanctuary.openStorageDirectory();
        }}
      />

      <main ref={mainRef} className="animate-fade-in" onScroll={(event) => {
        if (activeView === "gallery") scrollPositions.current.set(scrollKey, event.currentTarget.scrollTop);
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
        {activeView === "gallery" ? (
          <GalleryView
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
            collections={collections}
            artists={artists}
            selectedWorkIds={analysisWorkIds}
            status={status}
            error={error}
            onApplied={refreshLibrary}
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
            settings={filterSettings}
            appearance={appearance}
            libraryPreferences={libraryPreferences}
            customGroups={customElementGroups}
            status={status}
            savingGroupId={savingGroupId}
            error={error}
            storageLocation={storageLocation}
            onEdit={editFilterSetting}
            onSave={saveFilterSetting}
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
            onCustomGroupsChange={async (groups) => {
              setCustomElementGroups(await window.sanctuary.updateCustomElementGroups(groups));
              setFilterSettings(await window.sanctuary.listFilterSettings());
            }}
          />
        ) : (
          <ExploreView
            state={exploreState}
            error={error}
            isDrawerOpen={Boolean(inspectorTarget)}
            isModalOpen={Boolean(bookmarkPreview || collectionEditor || quickActionsOpen)}
            focusOnShow={nativeFocusPending.current}
            onFocusRestored={() => { nativeFocusPending.current = false; }}
            onStateChange={setExploreState}
            onError={showError}
          />
        )}
        </Suspense>
      </main>
      <Suspense fallback={null}>
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
