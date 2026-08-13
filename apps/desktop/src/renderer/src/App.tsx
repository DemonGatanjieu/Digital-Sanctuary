import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ELEMENT_BLACKLIST_GROUPS,
  type ArtistRecord,
  type ArtworkRecord,
  type CollectionRecord,
  type ElementFilterSetting,
  type FilterAction,
  type WorkQuery,
  type WorkQueryResult
} from "@sanctuary/domain";
import type {
  ExploreBounds,
  ExploreCommand,
  ExploreState
} from "../../preload/index";
import { WorkLibrary } from "./WorkLibrary";
import { CollectionEditor, type CollectionDraft } from "./CollectionEditor";

interface AppStatus {
  visionEngine: string;
  visionProvider: string;
  visionReady: boolean;
  modelBacked: boolean;
}

type ActiveView = "gallery" | "explore" | "rules";
type GalleryMode = "flat" | "author-work" | "collections";

const actionText: Record<FilterAction, string> = {
  allow: "清晰",
  blur: "已模糊",
  hide: "已隐藏"
};

const EMPTY_WORK_RESULT: WorkQueryResult = {
  items: [],
  total: 0,
  totalPages: 0,
  offset: 0,
  limit: 60,
  hasMore: false
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
  const [galleryMode, setGalleryMode] = useState<GalleryMode>("flat");
  const showError = useCallback((caught: unknown) => {
    setError(caught instanceof Error ? caught.message : "发生未知错误");
  }, []);

  const refreshWorks = useCallback(async (query: WorkQuery = workQuery) => {
    setWorkResult(await window.sanctuary.queryWorks(query));
  }, [workQuery]);

  const refreshLibrary = useCallback(async () => {
    const [nextWorks, nextCollections, nextArtists, nextArtworks] = await Promise.all([
      window.sanctuary.queryWorks(workQuery),
      window.sanctuary.listCollections(),
      window.sanctuary.listArtists(),
      galleryMode === "flat" ? Promise.resolve(null) : window.sanctuary.listArtworks()
    ]);
    setWorkResult(nextWorks);
    if (nextArtworks) setArtworks(nextArtworks);
    setCollections(nextCollections);
    setArtists(nextArtists);
  }, [galleryMode, workQuery]);

  useEffect(() => {
    void Promise.all([
      window.sanctuary.listCollections(),
      window.sanctuary.listFilterSettings(),
      window.sanctuary.status(),
      window.sanctuary.listArtists()
    ])
      .then(([nextCollections, nextFilterSettings, nextStatus, nextArtists]) => {
        setCollections(nextCollections);
        setFilterSettings(nextFilterSettings);
        setStatus(nextStatus);
        setArtists(nextArtists);
      })
      .catch(showError);
  }, []);

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

  async function downloadAllBookmarks() {
    setError("");
    try {
      const preview = await window.sanctuary.previewBookmarkDownload();
      if (preview.total === 0) {
        window.alert("这个收藏页中没有可下载的作品。");
        return;
      }
      const confirmed = window.confirm(
        `即将把 ${preview.total} 个收藏作品下载到本地画廊。\n\n` +
        "多页作品会完整保存；已经下载过的文件会跳过。" +
        "收藏内容视为你已确认，不再执行 AI 审查。是否继续？"
      );
      if (!confirmed) return;
      await window.sanctuary.downloadAllBookmarks();
      await refreshLibrary();
    } catch (caught) {
      showError(caught);
    }
  }

  const downloadBusy = exploreState.download.phase === "discovering" ||
    exploreState.download.phase === "downloading";

  return (
    <div className={`app-shell ${activeView === "explore" ? "exploring" : ""}`}>
      <aside className="sidebar">
        <div className="brand-mark">DS</div>
        <div className="brand-copy">
          <strong>纯净领域</strong>
          <span>Digital Sanctuary</span>
        </div>

        <nav>
          <button
            className={`nav-item ${activeView === "gallery" ? "active" : ""}`}
            onClick={() => void openGallery()}
          >
            画廊
          </button>
          <button
            className={`nav-item ${activeView === "explore" ? "active" : ""}`}
            onClick={() => setActiveView("explore")}
          >
            探索
          </button>
          <button
            className={`nav-item ${activeView === "rules" ? "active" : ""}`}
            onClick={() => setActiveView("rules")}
          >
            规则
          </button>
        </nav>

        {activeView === "explore" && (
          <section className="explore-sidebar-actions">
            <p className="sidebar-section-label">保存到本地</p>
            <button
              className="explore-action primary-action"
              disabled={exploreState.pageKind !== "artwork" || downloadBusy}
              onClick={() => void downloadCurrentArtwork()}
            >
              <strong>保存当前作品</strong>
              <small>
                {exploreState.pageKind === "artwork"
                  ? `作品 ${exploreState.artworkId} · 自动保存全部页`
                  : "打开作品详情后可用"}
              </small>
            </button>
            <button
              className="explore-action"
              disabled={exploreState.pageKind !== "bookmarks" || downloadBusy}
              onClick={() => void downloadAllBookmarks()}
            >
              <strong>下载全部收藏</strong>
              <small>
                {exploreState.pageKind === "bookmarks"
                  ? "用户信任 · 不执行 AI 审查"
                  : "进入收藏作品页后可用"}
              </small>
            </button>
            <p className="download-location">图片 → Digital Sanctuary → Pixiv</p>
            {exploreState.download.phase !== "idle" && (
              <div className={`download-progress ${exploreState.download.phase}`}>
                <strong>{downloadPhaseLabel(exploreState.download.phase)}</strong>
                <span>{exploreState.download.message}</span>
                {(exploreState.download.totalArtworks > 0 || exploreState.download.totalPages > 0) && (
                  <small>
                    作品已处理 {exploreState.download.completedArtworks + exploreState.download.failedArtworks}/{exploreState.download.totalArtworks}
                    {`（成功 ${exploreState.download.completedArtworks} · 失败 ${exploreState.download.failedArtworks}）`}
                    {exploreState.download.totalPages > 0
                      ? ` · 已知页面 ${exploreState.download.completedPages}/${exploreState.download.totalPages}`
                      : ""}
                  </small>
                )}
              </div>
            )}
          </section>
        )}

        <div className="sidebar-spacer" />
        <div className="engine-card">
          <span className={`status-dot ${status?.visionReady ? "online" : ""}`} />
          <div>
          <small>视觉引擎 · {status?.visionProvider ?? "检测中"}</small>
            <strong>{status?.visionEngine ?? "连接中"}</strong>
          </div>
        </div>
        <p className="probe-warning">
          {status?.modelBacked
            ? "WD Tagger 元素雷达 · 不使用年龄分级"
            : "开发探针，不具备真实内容审查能力"}
        </p>
      </aside>

      <main className="animate-fade-in">
        {activeView === "gallery" ? (
          <GalleryView
            artworks={artworks}
            workResult={workResult}
            workQuery={workQuery}
            workLoading={workLoading}
            collections={collections}
            artists={artists}
            mode={galleryMode}
            busy={busy}
            repairingAvatars={repairingAvatars}
            avatarRepairMessage={avatarRepairMessage}
            error={error}
            onImport={importImages}
            onCreateCollection={() => setCollectionEditor("new")}
            onEditCollection={setCollectionEditor}
            onAssignCollection={assignCollection}
            onAssignWorkCollection={assignWorkCollection}
            onUpdateCollectionCover={updateCollectionCover}
            onRepairArtistAvatars={repairArtistAvatars}
            onModeChange={(nextMode) => void changeGalleryMode(nextMode)}
            onWorkQueryChange={setWorkQuery}
            onLoadMoreWorks={() => void loadMoreWorks()}
            onWorkLibraryChanged={() => refreshWorks()}
            onError={showError}
          />
        ) : activeView === "rules" ? (
          <RulesView
            settings={filterSettings}
            savingGroupId={savingGroupId}
            error={error}
            onEdit={editFilterSetting}
            onSave={saveFilterSetting}
          />
        ) : (
          <ExploreView
            state={exploreState}
            error={error}
            onStateChange={setExploreState}
            onError={showError}
          />
        )}
      </main>
      {collectionEditor && (
        <CollectionEditor
          collection={collectionEditor === "new" ? null : collectionEditor}
          saving={collectionSaving}
          onSave={saveCollection}
          onDelete={collectionEditor === "new" ? null : deleteEditedCollection}
          onClose={() => !collectionSaving && setCollectionEditor(null)}
        />
      )}
    </div>
  );
}

const initialExploreState: ExploreState = {
  url: "https://www.pixiv.net/",
  title: "Pixiv 探索",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  blockedResources: 0,
  blockedAds: 0,
  approvedResources: 0,
  pendingResources: 0,
  queuedResources: 0,
  remoteReviewCacheHits: 0,
  remoteReviewCacheMisses: 0,
  error: "",
  maximized: false,
  pageKind: "other",
  artworkId: "",
  bookmarkUserId: "",
  download: {
    phase: "idle",
    scope: null,
    totalArtworks: 0,
    completedArtworks: 0,
    failedArtworks: 0,
    totalPages: 0,
    completedPages: 0,
    skippedPages: 0,
    lastFailure: "",
    message: ""
  }
};

function downloadPhaseLabel(phase: ExploreState["download"]["phase"]): string {
  if (phase === "discovering") return "正在读取";
  if (phase === "downloading") return "正在保存";
  if (phase === "complete") return "下载完成";
  if (phase === "partial") return "部分完成";
  if (phase === "cancelled") return "已取消";
  if (phase === "error") return "下载失败";
  return "等待下载";
}

function ExploreView({
  state,
  error,
  onStateChange,
  onError
}: {
  state: ExploreState;
  error: string;
  onStateChange: (state: ExploreState) => void;
  onError: (caught: unknown) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [passwordSetupOpened, setPasswordSetupOpened] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let active = true;
    let shown = false;
    const unsubscribe = window.sanctuary.onExploreState(onStateChange);

    const measure = (): ExploreBounds | null => {
      const rect = surface.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 100) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };

    const syncBounds = () => {
      const bounds = measure();
      if (!bounds) return;
      if (!shown) {
        shown = true;
        void window.sanctuary.showExplore(bounds)
          .then((nextState) => {
            if (active) onStateChange(nextState);
            else void window.sanctuary.hideExplore();
          })
          .catch(onError);
      } else {
        void window.sanctuary.setExploreBounds(bounds).catch(onError);
      }
    };

    const observer = new ResizeObserver(syncBounds);
    observer.observe(surface);
    window.addEventListener("resize", syncBounds);
    syncBounds();

    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      unsubscribe();
      void window.sanctuary.hideExplore();
    };
  }, [onError, onStateChange]);

  async function runCommand(command: ExploreCommand) {
    try {
      onStateChange(await window.sanctuary.exploreCommand(command));
    } catch (caught) {
      onError(caught);
    }
  }

  async function openPasswordSetup() {
    try {
      onStateChange(await window.sanctuary.exploreCommand("open-password-setup"));
      setPasswordSetupOpened(true);
    } catch (caught) {
      onError(caught);
    }
  }

  return (
    <section className="explore-page animate-fade-in">
      <div className="browser-toolbar">
        <button
          title="后退"
          disabled={!state.canGoBack}
          onClick={() => void runCommand("back")}
        >
          ←
        </button>
        <button
          title="前进"
          disabled={!state.canGoForward}
          onClick={() => void runCommand("forward")}
        >
          →
        </button>
        <button title="刷新" onClick={() => void runCommand("reload")}>↻</button>
        <button title="Pixiv 首页" onClick={() => void runCommand("home")}>⌂</button>
        <div className="address-bar" title={state.url}>
          <span>{state.loading ? "连接中" : "HTTPS"}</span>
          <strong>{state.title || state.url}</strong>
          <small>{state.url}</small>
        </div>
        <button
          className="account-setup-button"
          title="在默认浏览器中打开 Pixiv 官方密码设置页"
          onClick={() => void openPasswordSetup()}
        >
          浏览器设置密码
        </button>
        <button className="login-button" onClick={() => void runCommand("login")}>
          邮箱登录
        </button>
        <div className="shield-status" title="作品图先由本地 WD Tagger 审查，未命中黑名单才显示">
          <span className="status-dot online" />
          队列 {state.queuedResources} · 审查中 {state.pendingResources} · 放行 {state.approvedResources} · 内容拦截 {state.blockedResources} · 网络广告 {state.blockedAds} · 缓存命中 {state.remoteReviewCacheHits}
        </div>
        <button
          className="maximize-button"
          title={state.maximized ? "还原窗口" : "最大化窗口"}
          onClick={() => void runCommand("maximize")}
        >
          {state.maximized ? "❐" : "□"}
        </button>
      </div>

      {(passwordSetupOpened || state.url.startsWith("https://accounts.pixiv.net/login")) && (
        <div className="auth-hint">
          {passwordSetupOpened
            ? "已在默认浏览器打开 Pixiv 官方密码设置页：先用 Google 登录并设置 Pixiv 密码，然后回到这里点“邮箱登录”。"
            : "如果账号只绑定了 Google，请先点“浏览器设置密码”；完成后回到这里使用邮箱登录。"}
        </div>
      )}
      {(state.error || error) && (
        <div className="error-banner explore-error">{state.error || error}</div>
      )}
      <div className="explore-surface" ref={surfaceRef}>
        <div className="explore-placeholder">
          <span>◇</span>
          <strong>正在建立隔离的 Pixiv 会话</strong>
          <small>作品图会先经过本地元素检测，安全后再显示。</small>
        </div>
      </div>
    </section>
  );
}

function GalleryView({
  artworks,
  workResult,
  workQuery,
  workLoading,
  collections,
  artists,
  mode,
  busy,
  repairingAvatars,
  avatarRepairMessage,
  error,
  onImport,
  onCreateCollection,
  onEditCollection,
  onAssignCollection,
  onAssignWorkCollection,
  onUpdateCollectionCover,
  onRepairArtistAvatars,
  onModeChange,
  onWorkQueryChange,
  onLoadMoreWorks,
  onWorkLibraryChanged,
  onError
}: {
  artworks: ArtworkRecord[];
  workResult: WorkQueryResult;
  workQuery: WorkQuery;
  workLoading: boolean;
  collections: CollectionRecord[];
  artists: ArtistRecord[];
  mode: GalleryMode;
  busy: boolean;
  repairingAvatars: boolean;
  avatarRepairMessage: string;
  error: string;
  onImport: () => void;
  onCreateCollection: () => void;
  onEditCollection: (collection: CollectionRecord) => void;
  onAssignCollection: (artworkId: string, collectionId: string) => void;
  onAssignWorkCollection: (workId: string, collectionId: string) => Promise<void>;
  onUpdateCollectionCover: (collectionId: string, artworkId: string | null) => void;
  onRepairArtistAvatars: () => void;
  onModeChange: (mode: GalleryMode) => void;
  onWorkQueryChange: (query: WorkQuery) => void;
  onLoadMoreWorks: () => void;
  onWorkLibraryChanged: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const authorGroups = useMemo(() => buildAuthorGroups(artworks, artists), [artworks, artists]);
  const [selectedAuthorKey, setSelectedAuthorKey] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedArtworkId, setSelectedArtworkId] = useState("");
  const selectedAuthor = authorGroups.find((author) => author.key === selectedAuthorKey) ?? null;
  const selectedCollection = collections.find((collection) => collection.id === selectedCollectionId) ?? null;
  const selectedArtwork = artworks.find((artwork) => artwork.id === selectedArtworkId) ?? null;
  const lightboxPages = useMemo(
    () => selectedArtwork ? artworkWorkPages(artworks, selectedArtwork) : [],
    [artworks, selectedArtwork]
  );
  const missingPixivMetadata = artworks.filter(
    (artwork) => !artwork.source && /^\d+_p\d+\./i.test(artwork.fileName)
  ).length;
  const missingAvatarCount = artists.filter((artist) => !artist.avatarLocalPath).length;
  const showAllWorks = () => {
    const { collectionId: _collectionId, ...withoutCollection } = workQuery;
    onWorkQueryChange({ ...withoutCollection, offset: 0 });
    onModeChange("flat");
  };
  useEffect(() => {
    if (mode !== "author-work") setSelectedAuthorKey("");
    if (mode !== "collections") setSelectedCollectionId("");
  }, [mode]);
  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">LOCAL-FIRST LIBRARY</p>
          <h1>你的数字庇护所</h1>
        </div>
        <div className="header-actions">
          <div className="gallery-mode-switch" aria-label="画廊布局">
            <button
              className={mode === "flat" ? "active" : ""}
              onClick={showAllWorks}
            >
              平铺
            </button>
            <button
              className={mode === "collections" ? "active" : ""}
              onClick={() => onModeChange("collections")}
            >
              分类
            </button>
            <button
              className={mode === "author-work" ? "active" : ""}
              onClick={() => onModeChange("author-work")}
            >
              作者 · 作品
            </button>
          </div>
          {mode === "author-work" && (
            <div className="avatar-repair-control">
              <button
                className="secondary"
                disabled={repairingAvatars || artists.length === 0}
                onClick={onRepairArtistAvatars}
              >
                {repairingAvatars
                  ? "正在补全头像…"
                  : missingAvatarCount > 0
                    ? `补全作者头像 (${missingAvatarCount})`
                    : "重新检查头像"}
              </button>
              {avatarRepairMessage && <small>{avatarRepairMessage}</small>}
            </div>
          )}
          <button className="secondary" onClick={onCreateCollection}>新建分类</button>
          <button className="primary" onClick={onImport} disabled={busy}>
            {busy ? "正在审查…" : "导入图片"}
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="summary-row">
        <article><span>作品</span><strong>{workResult.total}</strong></article>
        <article><span>图片页</span><strong>{workResult.totalPages}</strong></article>
        <article><span>作者</span><strong>{artists.length}</strong></article>
        <article><span>分类</span><strong>{collections.length}</strong></article>
      </section>

      {workResult.total === 0 && !workQuery.search ? (
        <section className="empty-state">
          <div className="empty-orbit"><span>✦</span></div>
          <p className="eyebrow">FIRST VERTICAL SLICE</p>
          <h2>从一张真正喜欢的图片开始</h2>
          <p>图片保留在原位置；纯净领域只建立索引、审查结果和分类关系。</p>
          <button className="primary" onClick={onImport} disabled={busy}>选择本地图片</button>
        </section>
      ) : mode === "collections" ? (
        selectedCollection ? (
          <CollectionDetailPage
            collection={selectedCollection}
            artworks={artworks}
            collections={collections}
            onBack={() => setSelectedCollectionId("")}
            onAssign={onAssignCollection}
            onOpenArtwork={setSelectedArtworkId}
            onSetCover={(artworkId) => onUpdateCollectionCover(selectedCollection.id, artworkId)}
          />
        ) : (
          <section className="collections-grid">
            {collections.length === 0 && (
              <div className="empty-state">
                <p className="eyebrow">NO COLLECTIONS</p>
                <h2>暂无分类</h2>
                <p>点击上方“新建分类”来组织你的画廊</p>
              </div>
            )}
            {collections.map(collection => (
              <CollectionCard
                key={collection.id}
                collection={collection}
                artworks={artworks}
                onOpen={() => {
                  onWorkQueryChange({ ...workQuery, collectionId: collection.id, offset: 0 });
                  onModeChange("flat");
                }}
                onEdit={() => onEditCollection(collection)}
              />
            ))}
          </section>
        )
      ) : mode === "flat" ? (
        <WorkLibrary
          result={workResult}
          query={workQuery}
          collections={collections}
          loading={workLoading}
          onQueryChange={onWorkQueryChange}
          onLoadMore={onLoadMoreWorks}
          onAssignCollection={onAssignWorkCollection}
          onLibraryChanged={onWorkLibraryChanged}
          onError={onError}
        />
      ) : (
        <section className="author-gallery">
          {missingPixivMetadata > 0 && (
            <div className="metadata-hint">
              还有 {missingPixivMetadata} 页旧下载缺少作者信息。再次执行“下载全部收藏”会命中去重，
              只补作者资料并恢复为用户信任。
            </div>
          )}
          {!selectedAuthor ? (
            <div className="author-browser-grid">
              {authorGroups.map((author) => (
                <AuthorBrowserCard
                  key={author.key}
                  author={author}
                  onOpen={() => setSelectedAuthorKey(author.key)}
                />
              ))}
            </div>
          ) : (
            <AuthorDetailPage
              author={selectedAuthor}
              collections={collections}
              onBack={() => setSelectedAuthorKey("")}
              onAssign={onAssignCollection}
              onOpenArtwork={setSelectedArtworkId}
            />
          )}
        </section>
      )}
      {selectedArtwork && (
        <ArtworkLightbox
          artwork={selectedArtwork}
          pages={lightboxPages}
          onClose={() => setSelectedArtworkId("")}
          onSelect={(artwork) => setSelectedArtworkId(artwork.id)}
        />
      )}
    </>
  );
}

interface AuthorGalleryGroup {
  key: string;
  id: string;
  name: string;
  pageCount: number;
  artistRecord?: ArtistRecord;
  works: Array<{
    key: string;
    workId: string;
    title: string;
    pages: ArtworkRecord[];
  }>;
}

function buildAuthorGroups(artworks: readonly ArtworkRecord[], artists: readonly ArtistRecord[]): AuthorGalleryGroup[] {
  const authors = new Map<string, AuthorGalleryGroup>();
  for (const artwork of artworks) {
    const inferred = inferPixivWorkFromFileName(artwork.fileName);
    const authorId = artwork.source?.authorId ?? "";
    const authorName = artwork.source?.authorName ?? "待补充作者信息";
    const authorKey = authorId ? `pixiv:${authorId}` : "pixiv:unknown";
    const workId = artwork.source?.workId ?? inferred?.workId ?? artwork.id;
    const workKey = `${authorKey}:work:${workId}`;
    let author = authors.get(authorKey);
    if (!author) {
      const artistRecord = artists.find(a => a.id === authorId);
      author = { key: authorKey, id: authorId, name: authorName, pageCount: 0, works: [] };
      if (artistRecord) author.artistRecord = artistRecord;
      authors.set(authorKey, author);
    }
    let work = author.works.find((candidate) => candidate.key === workKey);
    if (!work) {
      work = {
        key: workKey,
        workId,
        title: artwork.source?.title ?? (inferred ? `Pixiv 作品 ${workId}` : artwork.fileName),
        pages: []
      };
      author.works.push(work);
    }
    work.pages.push(artwork);
    author.pageCount += 1;
  }
  for (const author of authors.values()) {
    for (const work of author.works) {
      work.pages.sort((left, right) => artworkPageIndex(left) - artworkPageIndex(right));
    }
  }
  return [...authors.values()];
}

function inferPixivWorkFromFileName(fileName: string): { workId: string; pageIndex: number } | null {
  const match = fileName.match(/^(\d+)_p(\d+)\.[^.]+$/i);
  const workId = match?.[1];
  const pageIndex = Number(match?.[2]);
  return workId && Number.isSafeInteger(pageIndex) ? { workId, pageIndex } : null;
}

function artworkPageIndex(artwork: ArtworkRecord): number {
  return artwork.source?.pageIndex ?? inferPixivWorkFromFileName(artwork.fileName)?.pageIndex ?? 0;
}

function artworkWorkPages(
  artworks: readonly ArtworkRecord[],
  selected: ArtworkRecord
): ArtworkRecord[] {
  const selectedWorkId = selected.source?.workId ?? inferPixivWorkFromFileName(selected.fileName)?.workId;
  if (!selectedWorkId) return [selected];
  return artworks
    .filter((artwork) =>
      (artwork.source?.workId ?? inferPixivWorkFromFileName(artwork.fileName)?.workId) === selectedWorkId
    )
    .sort((left, right) => artworkPageIndex(left) - artworkPageIndex(right));
}

function AuthorAvatar({
  author,
  large = false
}: {
  author: AuthorGalleryGroup;
  large?: boolean;
}) {
  const localPath = author.artistRecord?.avatarLocalPath ?? "";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [localPath]);
  const className = `author-monogram${large ? " large" : ""}`;
  if (localPath && !failed) {
    return (
      <img
        className={`${className} avatar`}
        src={`sanctuary-image://local/${encodeURIComponent(localPath)}`}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }
  return <span className={className}>{author.name.slice(0, 1).toUpperCase()}</span>;
}

function AuthorBrowserCard({
  author,
  onOpen
}: {
  author: AuthorGalleryGroup;
  onOpen: () => void;
}) {
  const covers = author.works.flatMap((work) => work.pages).slice(0, 3);
  return (
    <button className="author-browser-card" onClick={onOpen}>
      <span className={`author-cover-grid covers-${Math.min(3, covers.length)}`}>
        {covers.map((artwork) => {
          const action = artwork.decision?.action ?? "blur";
          return action === "hide" ? (
            <span className="author-cover-shield" key={artwork.id}>◇</span>
          ) : (
            <LazyArtworkImage
              key={artwork.id}
              src={artworkImageUrl(artwork)}
              className={action === "blur" ? "blurred" : ""}
            />
          );
        })}
      </span>
      <span className="author-card-body">
        <AuthorAvatar author={author} />
        <span className="author-card-copy">
          <strong>{author.name}</strong>
          <small>{author.works.length} 个作品 · {author.pageCount} 页</small>
        </span>
        <span className="author-card-arrow">→</span>
      </span>
    </button>
  );
}

function AuthorDetailPage({
  author,
  collections,
  onBack,
  onAssign,
  onOpenArtwork
}: {
  author: AuthorGalleryGroup;
  collections: CollectionRecord[];
  onBack: () => void;
  onAssign: (artworkId: string, collectionId: string) => void;
  onOpenArtwork: (artworkId: string) => void;
}) {
  return (
    <section className="author-detail-page">
      <button className="author-back" onClick={onBack}>← 全部作者</button>
      <header className="author-detail-hero">
        <AuthorAvatar author={author} large />
        <div>
          <p className="eyebrow">CREATOR LIBRARY</p>
          <h2>{author.name}</h2>
          <span>{author.works.length} 个作品 · {author.pageCount} 页</span>
        </div>
        {author.id && (
          <a href={`https://www.pixiv.net/users/${author.id}`} target="_blank" rel="noreferrer" className="pixiv-link">
            <code>pixiv/{author.id}</code>
          </a>
        )}
      </header>
      <div className="author-works">
        {author.works.map((work) => (
          <section className="work-group" key={work.key}>
            <header className="work-header">
              <div>
                <span>WORK {work.workId}</span>
                <h3>{work.title}</h3>
              </div>
              <strong>{work.pages.length} 页</strong>
            </header>
            <div className="work-page-grid">
              {work.pages.map((artwork) => (
                <ArtworkCard
                  key={artwork.id}
                  artwork={artwork}
                  collections={collections}
                  onAssign={onAssign}
                  onOpen={onOpenArtwork}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function ArtworkLightbox({
  artwork,
  pages,
  onClose,
  onSelect
}: {
  artwork: ArtworkRecord;
  pages: ArtworkRecord[];
  onClose: () => void;
  onSelect: (artwork: ArtworkRecord) => void;
}) {
  const currentIndex = Math.max(0, pages.findIndex((page) => page.id === artwork.id));
  const previous = pages[currentIndex - 1];
  const next = pages[currentIndex + 1];
  const [actualSize, setActualSize] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActualSize(false);
    setImageLoaded(false);
    setImageFailed(false);
  }, [artwork.id]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !imageLoaded) return;
    requestAnimationFrame(() => {
      stage.scrollTo({
        left: actualSize ? Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2) : 0,
        top: actualSize ? Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2) : 0
      });
    });
  }, [actualSize, artwork.id, imageLoaded]);

  useEffect(() => {
    document.body.classList.add("lightbox-open");
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => document.body.classList.remove("lightbox-open");
  }, []);

  useEffect(() => {
    for (const candidate of [previous, next]) {
      if (!candidate) continue;
      const image = new Image();
      image.src = artworkImageUrl(candidate);
    }
  }, [next, previous]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && previous) onSelect(previous);
      else if (event.key === "ArrowRight" && next) onSelect(next);
      else if (event.key === "0") setActualSize(false);
      else if (event.key === "1") setActualSize(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, onClose, onSelect, previous]);

  return createPortal(
    <div
      className="artwork-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={artwork.source?.title ?? artwork.fileName}
    >
      <header className="lightbox-toolbar">
        <div className="lightbox-heading">
          <strong>{artwork.source?.title ?? artwork.fileName}</strong>
          <small>{artwork.source?.authorName ?? "本地作品"}</small>
        </div>
        <div className="lightbox-actions">
          <button
            type="button"
            className={actualSize ? "active" : ""}
            aria-pressed={actualSize}
            title={actualSize ? "适应窗口（快捷键 0）" : "按原始像素查看（快捷键 1）"}
            onClick={() => setActualSize((current) => !current)}
          >
            {actualSize ? "适应窗口" : "1:1 原图"}
          </button>
          <button
            ref={closeButtonRef}
            type="button"
            className="lightbox-close"
            aria-label="关闭大图"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      <button
        className="lightbox-nav previous"
        aria-label="上一页"
        disabled={!previous}
        onClick={() => previous && onSelect(previous)}
      >
        ‹
      </button>
      <div
        ref={stageRef}
        className={`lightbox-stage ${actualSize ? "actual-size" : "fit-window"}`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {!imageLoaded && !imageFailed && <span className="lightbox-loader" aria-label="正在读取原图" />}
        {imageFailed && <div className="lightbox-load-error">原图读取失败，请关闭后重试。</div>}
        {!imageFailed && (
          <img
            key={artwork.id}
            src={artworkImageUrl(artwork)}
            alt=""
            className={`${artwork.decision?.action === "blur" ? "blurred " : ""}${imageLoaded ? "loaded" : "loading"}`}
            decoding="async"
            draggable={false}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageFailed(true)}
            onClick={() => setActualSize((current) => !current)}
          />
        )}
      </div>
      <button
        className="lightbox-nav next"
        aria-label="下一页"
        disabled={!next}
        onClick={() => next && onSelect(next)}
      >
        ›
      </button>
      <footer className="lightbox-footer">
        <span>{pages.length > 1 ? `${currentIndex + 1} / ${pages.length}` : "单页作品"}</span>
        <span>点击图片切换适应窗口 / 1:1</span>
        <span>← → 翻页 · Esc 关闭</span>
      </footer>
    </div>,
    document.body
  );
}

function RulesView({
  settings,
  savingGroupId,
  error,
  onEdit,
  onSave
}: {
  settings: ElementFilterSetting[];
  savingGroupId: string;
  error: string;
  onEdit: (setting: ElementFilterSetting) => void;
  onSave: (setting: ElementFilterSetting) => void;
}) {
  return (
    <>
      <header className="topbar rules-heading">
        <div>
          <p className="eyebrow">ELEMENT BLACKLIST</p>
          <h1>元素拦截规则</h1>
          <p className="page-description">
            这里只控制不受欢迎的画面元素。R18、裸体和露骨程度不参与拦截。
          </p>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="rules-grid">
        {ELEMENT_BLACKLIST_GROUPS.map((group) => {
          const setting = settings.find((item) => item.groupId === group.id);
          if (!setting) return null;
          const saving = savingGroupId === group.id;
          return (
            <article className={`rule-card ${setting.enabled ? "enabled" : "disabled"}`} key={group.id}>
              <div className="rule-card-header">
                <div>
                  <span className="rule-state">{setting.enabled ? "正在拦截" : "已停用"}</span>
                  <h2>{group.name}</h2>
                  <p>{group.description}</p>
                </div>
                <label className="switch" title={`切换${group.name}`}>
                  <input
                    type="checkbox"
                    checked={setting.enabled}
                    onChange={(event) => onEdit({ ...setting, enabled: event.target.checked })}
                  />
                  <span />
                </label>
              </div>

              <div className="tag-list">
                {group.tags.map((tag) => <code key={tag}>{tag}</code>)}
              </div>

              <div className="threshold-row">
                <label htmlFor={`threshold-${group.id}`}>
                  触发阈值 <strong>{Math.round(setting.minimumConfidence * 100)}%</strong>
                </label>
                <input
                  id={`threshold-${group.id}`}
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.05"
                  value={setting.minimumConfidence}
                  onChange={(event) =>
                    onEdit({ ...setting, minimumConfidence: Number(event.target.value) })
                  }
                />
                <small>越低越敏感，误拦截也会更多。</small>
              </div>

              <button
                className="secondary save-rule"
                disabled={saving}
                onClick={() => onSave(setting)}
              >
                {saving ? "保存中…" : "保存此组"}
              </button>
            </article>
          );
        })}
      </section>
    </>
  );
}

function ArtworkCard({
  artwork,
  collections,
  onAssign,
  onOpen
}: {
  artwork: ArtworkRecord;
  collections: CollectionRecord[];
  onAssign: (artworkId: string, collectionId: string) => void;
  onOpen: (artworkId: string) => void;
}) {
  const action = artwork.decision?.action ?? "blur";
  const imageUrl = artworkImageUrl(artwork);
  const reason = artwork.decision?.reasons[0];
  const analysisFailed = artwork.assessment?.status === "error";
  const trustedByUser = artwork.decision?.action === "allow" && !artwork.assessment;
  const detail = trustedByUser
    ? "Pixiv 主动下载 · 用户信任"
    : analysisFailed
    ? `分析失败 · ${artwork.assessment?.error ?? "未知错误"}`
    : reason
      ? `${reason.label} · ${Math.round(reason.confidence * 100)}%`
      : artwork.assessment?.engine ?? "等待审查";

  return (
    <article className={`art-card action-${action}`}>
      {action === "hide" ? (
        <div className="art-preview">
          <div className="shield"><span>◇</span><strong>内容已隐藏</strong></div>
          <span className={`decision-badge ${action}`}>{actionText[action]}</span>
        </div>
      ) : (
        <button
          className="art-preview art-preview-button"
          aria-label={`放大 ${artwork.source?.title ?? artwork.fileName}`}
          onClick={() => onOpen(artwork.id)}
        >
          <LazyArtworkImage
            src={imageUrl}
            className={action === "blur" ? "blurred" : ""}
          />
          {action !== "allow" && (
            <span className={`decision-badge ${action}`}>
              {analysisFailed ? "分析失败" : actionText[action]}
            </span>
          )}
        </button>
      )}
      <div className="art-meta">
        <strong title={artwork.fileName}>{artwork.fileName}</strong>
        <small title={detail}>{detail}</small>
        <select
          aria-label="加入分类"
          defaultValue=""
          onChange={(event) => onAssign(artwork.id, event.target.value)}
        >
          <option value="">加入分类…</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {artwork.collectionIds.includes(collection.id) ? "✓ " : ""}{collection.name}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

function artworkImageUrl(artwork: ArtworkRecord): string {
  return `sanctuary-image://local/${encodeURIComponent(artwork.path)}`;
}

function LazyArtworkImage({
  src,
  className = ""
}: {
  src: string;
  className?: string;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || shouldLoad) return;
    if (!("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "800px 0px", threshold: 0.01 }
    );
    observer.observe(image);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <img
      ref={imageRef}
      src={shouldLoad ? src : undefined}
      alt=""
      className={className}
      loading="lazy"
      decoding="async"
      fetchPriority="low"
      data-lazy-state={shouldLoad ? "loaded" : "waiting"}
    />
  );
}

function CollectionDetailPage({
  collection,
  artworks,
  collections,
  onBack,
  onAssign,
  onOpenArtwork,
  onSetCover
}: {
  collection: CollectionRecord;
  artworks: ArtworkRecord[];
  collections: CollectionRecord[];
  onBack: () => void;
  onAssign: (artworkId: string, collectionId: string) => void;
  onOpenArtwork: (artworkId: string) => void;
  onSetCover: (artworkId: string) => void;
}) {
  const items = artworks.filter((artwork) => artwork.collectionIds.includes(collection.id));
  return (
    <section className="author-detail-page collection-detail-page">
      <button className="author-back" onClick={onBack}>← 全部分类</button>
      <header className="author-detail-hero">
        <span className="author-monogram large">◇</span>
        <div>
          <p className="eyebrow">LOCAL COLLECTION</p>
          <h2>{collection.name}</h2>
          <span>{items.length} 张图片</span>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="collection-detail-empty">这个分类还没有图片。</div>
      ) : (
        <div className="gallery-grid collection-detail-grid">
          {items.map((artwork) => (
            <div className="collection-artwork" key={artwork.id}>
              <ArtworkCard
                artwork={artwork}
                collections={collections}
                onAssign={onAssign}
                onOpen={onOpenArtwork}
              />
              <button
                type="button"
                className={`collection-cover-action ${collection.coverArtworkId === artwork.id ? "active" : ""}`}
                onClick={() => onSetCover(artwork.id)}
                disabled={collection.coverArtworkId === artwork.id}
              >
                {collection.coverArtworkId === artwork.id ? "当前封面" : "设为分类封面"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CollectionCard({
  collection,
  artworks,
  onOpen,
  onEdit
}: {
  collection: CollectionRecord;
  artworks: ArtworkRecord[];
  onOpen: () => void;
  onEdit: () => void;
}) {
  const coverArtwork = artworks.find(a => a.id === collection.coverArtworkId) ?? 
    artworks.find(a => a.collectionIds.includes(collection.id));
  const coverUrl = coverArtwork ? artworkImageUrl(coverArtwork) : "";
  const count = artworks.filter(a => a.collectionIds.includes(collection.id)).length;
  
  return (
    <article className="collection-card" onClick={onOpen}>
      <button
        type="button"
        className="collection-edit-button"
        aria-label={`编辑分类 ${collection.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
      >
        ···
      </button>
      <div className="collection-cover">
        {coverUrl ? <img src={coverUrl} alt="" loading="lazy" /> : <div className="collection-cover-placeholder"><span>◇</span></div>}
      </div>
      <div className="collection-info">
        <h3>{collection.name}</h3>
        <small>{count} 个作品</small>
        {collection.description && <p className="collection-desc">{collection.description}</p>}
      </div>
    </article>
  );
}
