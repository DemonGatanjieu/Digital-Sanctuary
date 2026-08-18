import { useEffect, useRef, useState } from "react";
import type { ExploreBounds, ExploreCommand, ExploreState } from "../../preload/index";
import { AppNotice } from "./AppNotice";

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
  onStateChange,
  onError
}: {
  state: ExploreState;
  error: string;
  isDrawerOpen?: boolean;
  isModalOpen?: boolean;
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
      if (isModalOpen) {
        if (shown) {
          shown = false;
          void window.sanctuary.hideExplore();
        }
        return;
      }
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
  }, [isDrawerOpen, isModalOpen, onError, onStateChange]);

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
        <button title="后退" disabled={!state.canGoBack} onClick={() => void runCommand("back")}>←</button>
        <button title="前进" disabled={!state.canGoForward} onClick={() => void runCommand("forward")}>→</button>
        <button title="刷新" onClick={() => void runCommand("reload")}>↻</button>
        <button title="Pixiv 首页" onClick={() => void runCommand("home")}>⌂</button>
        <div className="address-bar" title={state.url}>
          <span>{state.loading ? "连接中" : "HTTPS"}</span>
          <strong>{state.title || state.url}</strong>
          <small>{state.url}</small>
        </div>
        <button className="account-setup-button" title="在默认浏览器中打开 Pixiv 官方密码设置页" onClick={() => void openPasswordSetup()}>浏览器设置密码</button>
        <button className="login-button" onClick={() => void runCommand("login")}>邮箱登录</button>
        <div className="shield-status" title="作品图先由本地 WD Tagger 审查，未命中黑名单才显示">
          <span className="status-dot online" />
          <span>放行 {state.approvedResources}</span>
          {state.blockedResources > 0 && <span style={{ color: "var(--ds-danger-text)", fontWeight: 700 }}>· 拦截 {state.blockedResources}</span>}
          {state.blockedAds > 0 && <span style={{ color: "var(--ds-warning-text)" }}>· 广告 {state.blockedAds}</span>}
          {state.remoteReviewCacheHits > 0 && <span>· 缓存 {state.remoteReviewCacheHits}</span>}
          {(state.pendingResources > 0 || state.queuedResources > 0) && (
            <span style={{ color: "var(--ds-primary)", fontWeight: 700 }}>· 审查中 {state.pendingResources + state.queuedResources}</span>
          )}
        </div>
        <button className="maximize-button" title={state.maximized ? "还原窗口" : "最大化窗口"} onClick={() => void runCommand("maximize")}>
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
      {(state.error || error) && <AppNotice tone="error" className="explore-error">{state.error || error}</AppNotice>}
      <div className={`explore-surface ${isDrawerOpen ? "with-drawer" : ""}`} ref={surfaceRef}>
        <div className="explore-placeholder">
          <span>◇</span>
          <strong>正在建立隔离的 Pixiv 会话</strong>
          <small>作品图会先经过本地元素检测，安全后再显示。</small>
        </div>
      </div>
    </section>
  );
}
