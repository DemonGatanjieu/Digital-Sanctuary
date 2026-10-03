import { useEffect, useRef, useState, type ReactNode } from "react";
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
  onProtectionOpen?: () => void;
  onProtectionClose?: () => void;
  onStateChange: (state: ExploreState) => void;
  onError: (caught: unknown) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const focusOnShowRef = useRef(focusOnShow);
  const focusRestoredRef = useRef(onFocusRestored);
  focusOnShowRef.current = focusOnShow;
  focusRestoredRef.current = onFocusRestored;
  const [passwordSetupOpened, setPasswordSetupOpened] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const protectedBrowsingReady = state.protectionStatus === "ready";
  const contentAvailable = protectedBrowsingReady || state.protectionStatus === "bypassed";

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
      if (isModalOpen || (isDrawerOpen && window.innerWidth <= 1100)) {
        if (shown) {
          shown = false;
          void window.sanctuary.hideExplore();
        }
        return;
      }
      const bounds = measure();
      if (!bounds || bounds.width < 100) {
        if (shown) {
          shown = false;
          void window.sanctuary.hideExplore();
        }
        return;
      }
      if (!shown) {
        shown = true;
        void window.sanctuary.showExplore(bounds)
          .then((nextState) => {
            if (active) {
              onStateChange(nextState);
              if (!protectionOpen && focusOnShowRef.current) {
                focusOnShowRef.current = false;
                void window.sanctuary.focusExplore().then(() => focusRestoredRef.current?.()).catch(onError);
              }
            }
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
  }, [isDrawerOpen, isModalOpen, protectionOpen, onError, onStateChange]);

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

  return (
    <section className="explore-page animate-fade-in">
      <div className="browser-toolbar">
        <button title="后退" disabled={!contentAvailable || !state.canGoBack} onClick={() => void runCommand("back")}>←</button>
        <button title="前进" disabled={!contentAvailable || !state.canGoForward} onClick={() => void runCommand("forward")}>→</button>
        <button title="刷新" disabled={!contentAvailable} onClick={() => void runCommand("reload")}>↻</button>
        <button title="Pixiv 首页" disabled={!contentAvailable} onClick={() => void runCommand("home")}>⌂</button>
        <div className="address-bar" title={state.url}>
          <span>{state.loading ? "连接中" : "HTTPS"}</span>
          <strong>{state.title || state.url}</strong>
          <small>{state.url}</small>
        </div>
        <button className="explore-account-trigger" type="button" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}>账号</button>
        <div className={`shield-status protection-${state.protectionStatus}`} title="本地模型状态与探索保护模式">
          <span className={`status-dot ${protectedBrowsingReady ? "online" : ""}`} />
          {state.protectionStatus === "bypassed" ? (
            <><strong>本次无保护浏览</strong><button onClick={() => void runCommand("resume-protection")}>恢复保护</button></>
          ) : state.protectionStatus === "starting" ? (
            <span>模型启动中</span>
          ) : state.protectionStatus === "failed" || state.protectionStatus === "stopped" ? (
            <span>模型未就绪</span>
          ) : (
            <>
              <span>保护已开启</span>
            </>
          )}
        </div>
        <button className="explore-protection-trigger" type="button" aria-expanded={protectionOpen}
          onClick={protectionOpen ? onProtectionClose : onProtectionOpen}>浏览保护</button>
        <button className="maximize-button" title={state.maximized ? "还原窗口" : "最大化窗口"} onClick={() => void runCommand("maximize")}>
          {state.maximized ? "❐" : "□"}
        </button>
      </div>
      {accountOpen && <div className="explore-account-actions" aria-label="登录与账号">
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
            <strong>{state.protectionStatus === "bypassed" ? "正在建立 Pixiv 会话" : "正在建立受保护的 Pixiv 会话"}</strong>
            <small>{state.protectionStatus === "bypassed" ? "当前会话不会隐藏图片。" : "只对确实命中个人规则的作品进行隐藏。"}</small>
          </div>
        )}
      </div>
      {protectionOpen && protectionPanel}
      </div>
    </section>
  );
}
