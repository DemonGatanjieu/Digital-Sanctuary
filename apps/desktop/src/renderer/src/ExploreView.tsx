import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ExploreBounds, ExploreCommand, ExploreState } from "../../preload/index";
import { AppNotice } from "./AppNotice";
import { Icon } from "./Icon";

export const initialExploreState: ExploreState = {
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
  protectionStatus: "starting",
  protectionError: "",
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

export function downloadPhaseLabel(phase: ExploreState["download"]["phase"]): string {
  if (phase === "discovering") return "正在读取";
  if (phase === "downloading") return "正在保存";
  if (phase === "complete") return "下载完成";
  if (phase === "partial") return "部分完成";
  if (phase === "cancelled") return "已取消";
  if (phase === "error") return "下载失败";
  return "等待下载";
}

export function ExploreView({
  state,
  error,
  isDrawerOpen = false,
  isModalOpen = false,
  focusOnShow = false,
  onFocusRestored,
  protectionOpen = false,
  protectionPanel,
  downloadBusy = false,
  onDownloadCurrentArtwork,
  onPreviewBookmarks,
  onOpenStorageDirectory,
  onProtectionOpen,
  onProtectionClose,
  onStateChange,
  onError
}: {
  state: ExploreState;
  error: string;
  isDrawerOpen?: boolean;
  isModalOpen?: boolean;
  focusOnShow?: boolean;
  onFocusRestored?: () => void;
  protectionOpen?: boolean;
  protectionPanel?: ReactNode;
  downloadBusy?: boolean;
  onDownloadCurrentArtwork?: () => void | Promise<void>;
  onPreviewBookmarks?: () => void | Promise<void>;
  onOpenStorageDirectory?: () => void;
  onProtectionOpen?: () => void;
  onProtectionClose?: () => void;
  onStateChange: (state: ExploreState) => void;
  onError: (caught: unknown) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const focusOnShowRef = useRef(focusOnShow);
  const focusRestoredRef = useRef(onFocusRestored);
  const visibilityRef = useRef({ isDrawerOpen, isModalOpen, protectionOpen });
  visibilityRef.current = { isDrawerOpen, isModalOpen, protectionOpen };
  const syncBoundsRef = useRef<(() => void) | null>(null);
  focusOnShowRef.current = focusOnShow;
  focusRestoredRef.current = onFocusRestored;
  const [passwordSetupOpened, setPasswordSetupOpened] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [address, setAddress] = useState(state.url);
  const [sites, setSites] = useState<Array<{url:string;title:string}>>([]);
  const addressComposing = useRef(false);
  const web = state.browserMode === "web";
  useEffect(() => { setAddress(state.url); }, [state.url]);
  useEffect(() => { void window.sanctuary.listExploreSites?.().then(setSites).catch(onError); }, [onError]);
  const protectedBrowsingReady = state.protectionStatus === "ready";
  const contentAvailable = protectedBrowsingReady || state.protectionStatus === "bypassed";

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let active = true;
    let shown = false;
    let visibilityVersion = 0;
    let lastBounds: ExploreBounds | null = null;
    const unsubscribe = window.sanctuary.onExploreState(onStateChange);

    const measure = (): ExploreBounds | null => {
      const rect = surface.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 100) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };

    const syncBounds = () => {
      const policy = visibilityRef.current;
      if (policy.isModalOpen || (policy.isDrawerOpen && window.innerWidth <= 1100)) {
        if (shown) {
          shown = false; visibilityVersion += 1; lastBounds = null;
          void window.sanctuary.hideExplore();
        }
        return;
      }
      const bounds = measure();
      if (!bounds || bounds.width < 100) {
        if (shown) {
          shown = false; visibilityVersion += 1; lastBounds = null;
          void window.sanctuary.hideExplore();
        }
        return;
      }
      if (!shown) {
        shown = true;
        lastBounds = bounds;
        const request = ++visibilityVersion;
        void window.sanctuary.showExplore(bounds)
          .then((nextState) => {
            if (active && shown && request === visibilityVersion) {
              onStateChange(nextState);
              if (!visibilityRef.current.protectionOpen && focusOnShowRef.current) {
                focusOnShowRef.current = false;
                void window.sanctuary.focusExplore().then(() => focusRestoredRef.current?.()).catch(onError);
              }
            }
          })
          .catch((cause) => { if (active && request === visibilityVersion) { shown = false; lastBounds = null; onError(cause); } });
      } else {
        if (!lastBounds || ["x", "y", "width", "height"].some((key) => bounds[key as keyof ExploreBounds] !== lastBounds![key as keyof ExploreBounds])) {
          lastBounds = bounds;
          void window.sanctuary.setExploreBounds(bounds).catch(onError);
        }
        if (!policy.protectionOpen && focusOnShowRef.current) {
          focusOnShowRef.current = false;
          void window.sanctuary.focusExplore().then(() => focusRestoredRef.current?.()).catch(onError);
        }
      }
    };

    const observer = new ResizeObserver(syncBounds);
    syncBoundsRef.current = syncBounds;
    observer.observe(surface);
    window.addEventListener("resize", syncBounds);
    syncBounds();

    return () => {
      active = false;
      syncBoundsRef.current = null;
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      unsubscribe();
      void window.sanctuary.hideExplore();
    };
  }, [onError, onStateChange]);

  useLayoutEffect(() => { syncBoundsRef.current?.(); }, [isDrawerOpen, isModalOpen, protectionOpen, focusOnShow]);

  useEffect(() => {
    if (!protectionOpen) return;
    document.querySelector<HTMLButtonElement>(".protection-panel-close")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229 || isModalOpen || isDrawerOpen) return;
      event.preventDefault();
      onProtectionClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [protectionOpen, isModalOpen, isDrawerOpen, onProtectionClose]);

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

  async function navigate(value: string) {
    try { onStateChange(await window.sanctuary.navigateExplore(value)); } catch (cause) { onError(cause); }
  }
  async function saveSite(remove?: string) {
    try { setSites(await window.sanctuary.saveExploreSite(remove)); } catch (cause) { onError(cause); }
  }

  return (
    <section className="explore-page">
      <div className="browser-toolbar">
        <button className="ui-icon-button" aria-label="后退" title="后退" disabled={!contentAvailable || !state.canGoBack} onClick={() => void runCommand("back")}><Icon name="chevronLeft" /></button>
        <button className="ui-icon-button" aria-label="前进" title="前进" disabled={!contentAvailable || !state.canGoForward} onClick={() => void runCommand("forward")}><Icon name="chevronRight" /></button>
        <button className="ui-icon-button" aria-label="刷新" title="刷新" disabled={!contentAvailable} onClick={() => void runCommand("reload")}><Icon name="refresh" /></button>
        <form className="ui-search explore-address-form" onSubmit={event => { event.preventDefault(); if (!addressComposing.current) void navigate(address); }}>
          <Icon name="search" size={16} />
          <input aria-label="网址或图片搜索" value={address} placeholder="输入网址或关键词找图" onChange={event => setAddress(event.target.value)} onCompositionStart={() => { addressComposing.current = true; }} onCompositionEnd={() => { addressComposing.current = false; }} />
          <button type="submit" className="ui-icon-button" aria-label="前往网址或搜索" title="前往"><Icon name="chevronRight" size={16} /></button>
        </form>
        <span className={`shield-status protection-${web ? "web" : state.protectionStatus}`} title={web ? "此网站尚未适配元素拦截" : "本地模型状态与探索保护"}>
          <span className={`status-dot ${!web && protectedBrowsingReady ? "online" : !web && state.protectionStatus === "bypassed" ? "warning" : ""}`} />
          {web ? "此站未适配元素拦截" : state.protectionStatus === "bypassed" ? "无保护浏览" : state.protectionStatus === "starting" ? "模型启动中" : state.protectionStatus === "failed" || state.protectionStatus === "stopped" ? "模型未就绪" : "保护已开启"}
          {!web && state.protectionStatus === "bypassed" && <button type="button" onClick={() => void runCommand("resume-protection")}>恢复保护</button>}
        </span>
        {!web && <button className="ui-tool-button explore-protection-trigger" type="button" aria-label="浏览保护" aria-expanded={protectionOpen}
          onClick={protectionOpen ? onProtectionClose : onProtectionOpen}><Icon name="shield" size={16} /><span>浏览保护</span></button>}
        {!web && <button className="ui-tool-button explore-account-trigger" type="button" aria-label="账号" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}><Icon name="user" size={16} /><span>账号</span></button>}
        {!web && (state.pageKind === "bookmarks" ? (
          <button className="explore-save-button" aria-label="下载全部收藏" disabled={downloadBusy} onClick={() => void onPreviewBookmarks?.()} title="先预览范围，再开始下载">
            <Icon name="download" size={16} /><span>下载全部收藏</span>
          </button>
        ) : (
          <button className="explore-save-button" aria-label="保存作品" disabled={state.pageKind !== "artwork" || downloadBusy} onClick={() => void onDownloadCurrentArtwork?.()}
            title={state.pageKind === "artwork" ? `保存作品 ${state.artworkId} 的全部页` : "打开作品详情后可保存"}>
            <Icon name="download" size={16} /><span>保存作品</span>
          </button>
        ))}
        <button className="ui-icon-button maximize-button" aria-label={state.maximized ? "还原窗口" : "最大化窗口"} title={state.maximized ? "还原窗口" : "最大化窗口"} onClick={() => void runCommand("maximize")}>
          <Icon name={state.maximized ? "restore" : "maximize"} size={16} />
        </button>
      </div>
      <nav className="explore-site-shortcuts" aria-label="网站快捷入口">
        <button onClick={() => void navigate("https://www.pixiv.net/")}>Pixiv</button>
        {sites.map(site => <span key={site.url}><button title={site.url} onClick={() => void navigate(site.url)}>{site.title}</button><button aria-label={`移除网站 ${site.title}`} title="移除" onClick={() => void saveSite(site.url)}><Icon name="close" size={12} /></button></span>)}
        <button className="explore-site-add" onClick={() => void saveSite()} title="把当前网站加入快捷入口"><Icon name="plus" size={14} />收藏网站</button>
        {web && <small>在图片上右键可加入图库</small>}
      </nav>
      {state.download.phase !== "idle" && (
        <div className={`explore-download-strip ${state.download.phase}`} role="status">
          <strong>{downloadPhaseLabel(state.download.phase)}</strong>
          <span>{state.download.message}</span>
          {state.download.totalArtworks > 0 && (
            <small>
              {state.download.completedArtworks + state.download.failedArtworks}/{state.download.totalArtworks} 件
              {state.download.failedArtworks > 0 ? ` · 失败 ${state.download.failedArtworks}` : ""}
            </small>
          )}
          {onOpenStorageDirectory && <button type="button" onClick={onOpenStorageDirectory}>打开文件夹</button>}
        </div>
      )}
      {state.notice && <AppNotice tone="success">{state.notice}</AppNotice>}
      {accountOpen && !web && <div className="explore-account-actions" aria-label="登录与账号">
        <button className="login-button" disabled={!contentAvailable} onClick={() => void runCommand("login")}>邮箱登录</button>
        <button className="account-setup-button" onClick={() => void openPasswordSetup()}>浏览器设置密码</button>
        <span>使用 Pixiv 邮箱登录；第三方账号可先在浏览器设置密码。</span>
      </div>}
      {(passwordSetupOpened || state.url.startsWith("https://accounts.pixiv.net/login")) && (
        <div className="auth-hint">
          {passwordSetupOpened
            ? "已在默认浏览器打开 Pixiv 官方密码设置页：先用 Google 登录并设置 Pixiv 密码，然后回到这里点“邮箱登录”。"
            : "如果账号只绑定了 Google，请先点“浏览器设置密码”；完成后回到这里使用邮箱登录。"}
        </div>
      )}
      {(state.error || error) && <AppNotice tone="error" className="explore-error">{state.error || error}</AppNotice>}
      <div className={`explore-workspace ${protectionOpen ? "protection-open" : ""}`}>
      <div className={`explore-surface ${isDrawerOpen ? "with-drawer" : ""}`} ref={surfaceRef}>
        {!contentAvailable ? (
          <div className={`explore-protection-gate ${state.protectionStatus}`}>
            <span className="protection-gate-mark">◇</span>
            <div>
              <small>本地探索保护</small>
              <strong>{state.protectionStatus === "starting" ? "正在装载识别模型" : "识别模型尚未就绪"}</strong>
              <p>{state.protectionStatus === "starting"
                ? "模型确认加载完成后，Pixiv 页面才会出现。画廊始终可以正常使用。"
                : "这不是图片命中规则，因此不会用大量遮罩冒充拦截结果。"}</p>
              {state.protectionError && state.protectionStatus !== "starting" && <details className="protection-failure-details"><summary>查看错误详情</summary><code>{state.protectionError}</code></details>}
              <div className="protection-gate-actions">
                <button className="primary" disabled={state.protectionStatus === "starting"} onClick={() => void runCommand("retry-vision")}>重新启动模型</button>
                <button disabled={state.protectionStatus === "starting"} onClick={() => void runCommand("browse-unprotected")}>本次无保护浏览</button>
                <button onClick={onProtectionOpen}>检查保护设置</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="explore-placeholder">
            <span>◇</span>
            <strong>{web ? "正在打开图片网站" : state.protectionStatus === "bypassed" ? "正在建立 Pixiv 会话" : "正在建立受保护的 Pixiv 会话"}</strong>
            <small>{web ? "可在图片上右键，选择加入图库。" : state.protectionStatus === "bypassed" ? "当前会话不会隐藏图片。" : "只对确实命中个人规则的作品进行隐藏。"}</small>
          </div>
        )}
      </div>
      {protectionOpen && protectionPanel}
      </div>
    </section>
  );
}
