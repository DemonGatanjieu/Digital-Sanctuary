import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ELEMENT_BLACKLIST_GROUPS,
  type ArtworkRecord,
  type CollectionRecord,
  type ElementFilterSetting,
  type FilterAction
} from "@sanctuary/domain";
import type {
  ExploreBounds,
  ExploreCommand,
  ExploreState
} from "../../preload/index";

interface AppStatus {
  visionEngine: string;
  visionReady: boolean;
  modelBacked: boolean;
}

type ActiveView = "gallery" | "explore" | "rules";

const actionText: Record<FilterAction, string> = {
  allow: "已放行",
  blur: "已模糊",
  hide: "已隐藏"
};

export function App() {
  const [activeView, setActiveView] = useState<ActiveView>("gallery");
  const [artworks, setArtworks] = useState<ArtworkRecord[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [filterSettings, setFilterSettings] = useState<ElementFilterSetting[]>([]);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingGroupId, setSavingGroupId] = useState("");
  const [error, setError] = useState("");
  const showError = useCallback((caught: unknown) => {
    setError(caught instanceof Error ? caught.message : "发生未知错误");
  }, []);

  useEffect(() => {
    void Promise.all([
      window.sanctuary.listArtworks(),
      window.sanctuary.listCollections(),
      window.sanctuary.listFilterSettings(),
      window.sanctuary.status()
    ])
      .then(([nextArtworks, nextCollections, nextFilterSettings, nextStatus]) => {
        setArtworks(nextArtworks);
        setCollections(nextCollections);
        setFilterSettings(nextFilterSettings);
        setStatus(nextStatus);
      })
      .catch(showError);
  }, []);

  const counts = useMemo(
    () => ({
      allow: artworks.filter((item) => item.decision?.action === "allow").length,
      guarded: artworks.filter((item) => item.decision?.action !== "allow").length
    }),
    [artworks]
  );

  async function importImages() {
    setBusy(true);
    setError("");
    try {
      setArtworks(await window.sanctuary.importImages());
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function createCollection() {
    const name = window.prompt("新分类名称");
    if (!name?.trim()) return;
    try {
      setCollections(await window.sanctuary.createCollection(name));
    } catch (caught) {
      showError(caught);
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
      setArtworks(await window.sanctuary.listArtworks());
    } catch (caught) {
      showError(caught);
    } finally {
      setSavingGroupId("");
    }
  }

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
            onClick={() => setActiveView("gallery")}
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

        <div className="sidebar-spacer" />
        <div className="engine-card">
          <span className={`status-dot ${status?.visionReady ? "online" : ""}`} />
          <div>
            <small>视觉引擎</small>
            <strong>{status?.visionEngine ?? "连接中"}</strong>
          </div>
        </div>
        <p className="probe-warning">
          {status?.modelBacked
            ? "WD Tagger 元素雷达 · 不使用年龄分级"
            : "开发探针，不具备真实内容审查能力"}
        </p>
      </aside>

      <main>
        {activeView === "gallery" ? (
          <GalleryView
            artworks={artworks}
            collections={collections}
            counts={counts}
            busy={busy}
            error={error}
            onImport={importImages}
            onCreateCollection={createCollection}
            onAssignCollection={assignCollection}
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
            error={error}
            onExit={() => setActiveView("gallery")}
            onError={showError}
          />
        )}
      </main>
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
  error: "",
  maximized: false
};

function ExploreView({
  error,
  onExit,
  onError
}: {
  error: string;
  onExit: () => void;
  onError: (caught: unknown) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ExploreState>(initialExploreState);
  const [passwordSetupOpened, setPasswordSetupOpened] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let active = true;
    let shown = false;
    const unsubscribe = window.sanctuary.onExploreState(setState);

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
            if (active) setState(nextState);
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
  }, [onError]);

  async function runCommand(command: ExploreCommand) {
    try {
      setState(await window.sanctuary.exploreCommand(command));
    } catch (caught) {
      onError(caught);
    }
  }

  async function openPasswordSetup() {
    try {
      setState(await window.sanctuary.exploreCommand("open-password-setup"));
      setPasswordSetupOpened(true);
    } catch (caught) {
      onError(caught);
    }
  }

  return (
    <section className="explore-page">
      <div className="browser-toolbar">
        <button className="exit-explore" title="返回本地画廊" onClick={onExit}>
          ← 画廊
        </button>
        <span className="toolbar-divider" />
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
          审查中 {state.pendingResources} · 放行 {state.approvedResources} · 内容拦截 {state.blockedResources} · 广告拦截 {state.blockedAds}
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
  collections,
  counts,
  busy,
  error,
  onImport,
  onCreateCollection,
  onAssignCollection
}: {
  artworks: ArtworkRecord[];
  collections: CollectionRecord[];
  counts: { allow: number; guarded: number };
  busy: boolean;
  error: string;
  onImport: () => void;
  onCreateCollection: () => void;
  onAssignCollection: (artworkId: string, collectionId: string) => void;
}) {
  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">LOCAL-FIRST LIBRARY</p>
          <h1>你的数字庇护所</h1>
        </div>
        <div className="header-actions">
          <button className="secondary" onClick={onCreateCollection}>新建分类</button>
          <button className="primary" onClick={onImport} disabled={busy}>
            {busy ? "正在审查…" : "导入图片"}
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="summary-row">
        <article><span>作品</span><strong>{artworks.length}</strong></article>
        <article><span>已放行</span><strong>{counts.allow}</strong></article>
        <article><span>受保护</span><strong>{counts.guarded}</strong></article>
        <article><span>分类</span><strong>{collections.length}</strong></article>
      </section>

      {artworks.length === 0 ? (
        <section className="empty-state">
          <div className="empty-orbit"><span>✦</span></div>
          <p className="eyebrow">FIRST VERTICAL SLICE</p>
          <h2>从一张真正喜欢的图片开始</h2>
          <p>图片保留在原位置；纯净领域只建立索引、审查结果和分类关系。</p>
          <button className="primary" onClick={onImport} disabled={busy}>选择本地图片</button>
        </section>
      ) : (
        <section className="gallery-grid">
          {artworks.map((artwork) => (
            <ArtworkCard
              key={artwork.id}
              artwork={artwork}
              collections={collections}
              onAssign={onAssignCollection}
            />
          ))}
        </section>
      )}
    </>
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
  onAssign
}: {
  artwork: ArtworkRecord;
  collections: CollectionRecord[];
  onAssign: (artworkId: string, collectionId: string) => void;
}) {
  const action = artwork.decision?.action ?? "blur";
  const imageUrl = `sanctuary-image://local/${encodeURIComponent(artwork.path)}`;
  const reason = artwork.decision?.reasons[0];
  const analysisFailed = artwork.assessment?.status === "error";
  const detail = analysisFailed
    ? `分析失败 · ${artwork.assessment?.error ?? "未知错误"}`
    : reason
      ? `${reason.label} · ${Math.round(reason.confidence * 100)}%`
      : artwork.assessment?.engine ?? "等待审查";

  return (
    <article className={`art-card action-${action}`}>
      <div className="art-preview">
        {action === "hide" ? (
          <div className="shield"><span>◇</span><strong>内容已隐藏</strong></div>
        ) : (
          <img src={imageUrl} alt="" className={action === "blur" ? "blurred" : ""} />
        )}
        <span className={`decision-badge ${action}`}>
          {analysisFailed ? "分析失败" : actionText[action]}
        </span>
      </div>
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
