import { useCallback, useEffect, useState } from "react";
import {
  type AppearancePreferences,
  type ArtistRecord,
  type ArtworkRecord,
  type CollectionRecord,
  type CustomElementGroup,
  type ElementFilterSetting,
  DEFAULT_LIBRARY_PREFERENCES,
  type LibraryPreferences,
  type SavedCollectionView,
  type SavedCollectionViewDraft,
  type WorkQuery,
  type WorkQueryResult
} from "@sanctuary/domain";
import type { ExploreState } from "../../preload/index";
import { CollectionEditor, type CollectionDraft } from "./CollectionEditor";
import { BookmarkDownloadDialog } from "./BookmarkDownloadDialog";
import { ElementInspectorDrawer, type ElementInspectorTarget } from "./ElementInspectorDrawer";
import { SettingsView } from "./SettingsView";
import { AnalysisView } from "./AnalysisView";
import { ModelCenterView } from "./ModelCenterView";
import { ExploreView, initialExploreState } from "./ExploreView";
import { InspirationView } from "./InspirationView";
import { AppSidebar, type ActiveView, type AppStatus } from "./AppSidebar";
import { GalleryView, type GalleryMode } from "./GalleryView";
import type { BookmarkDownloadPreview } from "../../shared/pixiv-download.js";

const EMPTY_WORK_RESULT: WorkQueryResult = {
  items: [],
  total: 0,
  totalPages: 0,
  offset: 0,
  limit: 60,
  hasMore: false
};

const DEFAULT_APPEARANCE: AppearancePreferences = {
  displayProfile: "balanced",
  reducedMotion: false,
  ambientArtwork: true
};

export function App() {
  const [activeView, setActiveView] = useState<ActiveView>("gallery");
  const [artworks, setArtworks] = useState<ArtworkRecord[]>([]);
  const [workResult, setWorkResult] = useState<WorkQueryResult>(EMPTY_WORK_RESULT);
  const [workQuery, setWorkQuery] = useState<WorkQuery>({
    sortBy: "savedAt",
    direction: "desc",
    offset: 0,
    limit: 60
  });
  const [workLoading, setWorkLoading] = useState(false);
  const [collectionEditor, setCollectionEditor] = useState<CollectionRecord | "new" | null>(null);
  const [collectionSaving, setCollectionSaving] = useState(false);
  const [appearance, setAppearance] = useState<AppearancePreferences>(DEFAULT_APPEARANCE);
  const [libraryPreferences, setLibraryPreferences] = useState<LibraryPreferences>(DEFAULT_LIBRARY_PREFERENCES);
  const [customElementGroups, setCustomElementGroups] = useState<CustomElementGroup[]>([]);
  const [bookmarkPreview, setBookmarkPreview] = useState<BookmarkDownloadPreview | null>(null);
  const [startingBookmarkDownload, setStartingBookmarkDownload] = useState(false);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [savedCollectionViews, setSavedCollectionViews] = useState<SavedCollectionView[]>([]);
  const [artists, setArtists] = useState<ArtistRecord[]>([]);
  const [filterSettings, setFilterSettings] = useState<ElementFilterSetting[]>([]);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [repairingAvatars, setRepairingAvatars] = useState(false);
  const [avatarRepairMessage, setAvatarRepairMessage] = useState("");
  const [savingGroupId, setSavingGroupId] = useState("");
  const [error, setError] = useState("");
  const [exploreState, setExploreState] = useState<ExploreState>(initialExploreState);
  const [galleryMode, setGalleryMode] = useState<GalleryMode>("flat");
  const [analysisWorkIds, setAnalysisWorkIds] = useState<string[]>([]);
  const [inspectorTarget, setInspectorTarget] = useState<ElementInspectorTarget | null>(null);
  const [inspirationLaunch, setInspirationLaunch] = useState<{ workId: string; pageIndex: number } | null>(null);
  const showError = useCallback((caught: unknown) => {
    setError(caught instanceof Error ? caught.message : "发生未知错误");
  }, []);

  const refreshWorks = useCallback(async (query: WorkQuery = workQuery) => {
    setWorkResult(await window.sanctuary.queryWorks(query));
  }, [workQuery]);

  const refreshLibrary = useCallback(async () => {
    const [nextWorks, nextCollections, nextArtists, nextArtworks, nextSavedViews] = await Promise.all([
      window.sanctuary.queryWorks(workQuery),
      window.sanctuary.listCollections(),
      window.sanctuary.listArtists(),
      galleryMode === "flat" ? Promise.resolve(null) : window.sanctuary.listArtworks(),
      window.sanctuary.listSavedCollectionViews()
    ]);
    setWorkResult(nextWorks);
    if (nextArtworks) setArtworks(nextArtworks);
    setCollections(nextCollections);
    setArtists(nextArtists);
    setSavedCollectionViews(nextSavedViews);
  }, [galleryMode, workQuery]);

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
      window.sanctuary.listSavedCollectionViews(),
      window.sanctuary.listFilterSettings(),
      window.sanctuary.status(),
      window.sanctuary.listArtists(),
      window.sanctuary.getAppearancePreferences(),
      window.sanctuary.getLibraryPreferences(),
      window.sanctuary.listCustomElementGroups()
    ])
      .then(([nextCollections, nextSavedViews, nextFilterSettings, nextStatus, nextArtists, nextAppearance, nextLibraryPreferences, nextCustomGroups]) => {
        setCollections(nextCollections);
        setSavedCollectionViews(nextSavedViews);
        setFilterSettings(nextFilterSettings);
        setStatus(nextStatus);
        setArtists(nextArtists);
        setAppearance(nextAppearance);
        setLibraryPreferences(nextLibraryPreferences);
        setCustomElementGroups(nextCustomGroups);
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
      for (let batch = 0; batch < 80; batch += 1) {
        await waitForRendererIdle();
        const result = await window.sanctuary.generateThumbnails();
        changed ||= result.generated + result.reused > 0;
        if (result.attempted < 6 || result.generated + result.reused === 0) break;
        await new Promise((resolveTask) => window.setTimeout(resolveTask, 120));
      }
      if (active && changed) await refreshWorks();
    })().catch(showError);
    return () => {
      active = false;
    };
  }, [refreshWorks, showError]);

  useEffect(() => {
    if (activeView !== "gallery" || galleryMode !== "flat") return;
    const timer = window.setTimeout(() => {
      setWorkLoading(true);
      void window.sanctuary.queryWorks(workQuery)
        .then(setWorkResult)
        .catch(showError)
        .finally(() => setWorkLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeView, galleryMode, showError, workQuery]);

  async function importImages() {
    setBusy(true);
    setError("");
    try {
      await window.sanctuary.importImages();
      await refreshWorks();
      if (galleryMode !== "flat") setArtworks(await window.sanctuary.listArtworks());
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
      setSavedCollectionViews(await window.sanctuary.listSavedCollectionViews());
    } catch (caught) {
      showError(caught);
      throw caught;
    }
  }

  async function deleteSavedCollectionView(id: string) {
    try {
      await window.sanctuary.deleteSavedCollectionView(id);
      setSavedCollectionViews(await window.sanctuary.listSavedCollectionViews());
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
    } catch (caught) {
      showError(caught);
    } finally {
      setCollectionSaving(false);
    }
  }

  async function assignCollection(artworkId: string, collectionId: string) {
    if (!collectionId) return;
    try {
      setArtworks(await window.sanctuary.addArtworkToCollection(artworkId, collectionId));
    } catch (caught) {
      showError(caught);
    }
  }

  async function assignWorkCollection(workId: string, collectionId: string) {
    if (!collectionId) return;
    try {
      await window.sanctuary.addWorkToCollection(workId, collectionId);
      await refreshWorks();
    } catch (caught) {
      showError(caught);
    }
  }

  async function updateCollectionCover(collectionId: string, artworkId: string | null) {
    try {
      setCollections(await window.sanctuary.updateCollectionCover(collectionId, artworkId));
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
    try {
      await refreshLibrary();
    } catch (caught) {
      showError(caught);
    }
  }

  async function changeGalleryMode(mode: GalleryMode) {
    setGalleryMode(mode);
    if (mode === "flat" || artworks.length > 0) return;
    try {
      setArtworks(await window.sanctuary.listArtworks());
    } catch (caught) {
      showError(caught);
    }
  }

  async function loadMoreWorks() {
    if (workLoading || !workResult.hasMore) return;
    setWorkLoading(true);
    try {
      const next = await window.sanctuary.queryWorks({
        ...workQuery,
        offset: workResult.items.length,
        limit: workResult.limit
      });
      setWorkResult((current) => ({
        ...next,
        offset: 0,
        items: [...current.items, ...next.items]
      }));
    } catch (caught) {
      showError(caught);
    } finally {
      setWorkLoading(false);
    }
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
        onOpenGallery={openGallery}
        onViewChange={setActiveView}
        onDownloadCurrentArtwork={downloadCurrentArtwork}
        onPreviewBookmarks={previewAllBookmarks}
        onAppearanceChange={updateAppearance}
      />

      <main className="animate-fade-in">
        {activeView === "gallery" ? (
          <GalleryView
            artworks={artworks}
            workResult={workResult}
            workQuery={workQuery}
            workLoading={workLoading}
            collections={collections}
            savedCollectionViews={savedCollectionViews}
            artists={artists}
            appearance={appearance}
            mode={galleryMode}
            busy={busy}
            repairingAvatars={repairingAvatars}
            avatarRepairMessage={avatarRepairMessage}
            error={error}
            onImport={importImages}
            onCreateCollection={() => setCollectionEditor("new")}
            onEditCollection={setCollectionEditor}
            onSaveSavedView={saveSavedCollectionView}
            onDeleteSavedView={deleteSavedCollectionView}
            onAssignCollection={assignCollection}
            onAssignWorkCollection={assignWorkCollection}
            onUpdateCollectionCover={updateCollectionCover}
            onRepairArtistAvatars={repairArtistAvatars}
            onModeChange={(nextMode) => void changeGalleryMode(nextMode)}
            onWorkQueryChange={setWorkQuery}
            onLoadMoreWorks={() => void loadMoreWorks()}
            onWorkLibraryChanged={() => refreshWorks()}
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
        ) : activeView === "models" ? (
          <ModelCenterView onError={showError} />
        ) : activeView === "inspiration" ? (
          <InspirationView launch={inspirationLaunch} onLaunchConsumed={() => setInspirationLaunch(null)} />
        ) : activeView === "settings" ? (
          <SettingsView
            settings={filterSettings}
            appearance={appearance}
            libraryPreferences={libraryPreferences}
            customGroups={customElementGroups}
            status={status}
            savingGroupId={savingGroupId}
            error={error}
            onEdit={editFilterSetting}
            onSave={saveFilterSetting}
            onAppearanceChange={updateAppearance}
            onLibraryPreferencesChange={updateLibraryPreferences}
            onChooseDownloadDirectory={async () => setLibraryPreferences(await window.sanctuary.chooseDownloadDirectory())}
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
            isModalOpen={Boolean(bookmarkPreview || collectionEditor)}
            onStateChange={setExploreState}
            onError={showError}
          />
        )}
      </main>
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
