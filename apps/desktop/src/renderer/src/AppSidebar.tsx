import type { AppearancePreferences, StorageLocationInfo } from "@sanctuary/domain";
import type { ExploreState } from "../../preload/index";
import { downloadPhaseLabel } from "./ExploreView";
import { MAIN_NAVIGATION, mainViewFor, type ActiveView, type SettingsSection } from "./app-navigation";
export type { ActiveView } from "./app-navigation";

export interface AppStatus {
  visionEngine: string;
  visionProvider: string;
  visionReady: boolean;
  visionState: "starting" | "ready" | "failed" | "stopped";
  visionError: string;
  modelBacked: boolean;
}

export function AppSidebar({
  activeView,
  exploreState,
  downloadBusy,
  appearance,
  status,
  storageLocation,
  onOpenGallery,
  onQuickActions,
  onOpenTasks,
  taskCount = 0,
  onViewChange,
  onDownloadCurrentArtwork,
  onPreviewBookmarks,
  onOpenSettings,
  onChooseDownloadDirectory,
  onOpenStorageDirectory
}: {
  activeView: ActiveView;
  exploreState: ExploreState;
  downloadBusy: boolean;
  appearance: AppearancePreferences;
  status: AppStatus | null;
  storageLocation?: StorageLocationInfo | null;
  onOpenGallery: () => void | Promise<void>;
  onQuickActions?: () => void;
  onOpenTasks?: () => void;
  taskCount?: number;
  onViewChange: (view: ActiveView) => void;
  onDownloadCurrentArtwork: () => void | Promise<void>;
  onPreviewBookmarks: () => void | Promise<void>;
  onOpenSettings: (section: SettingsSection) => void;
  onChooseDownloadDirectory?: () => void | Promise<unknown>;
  onOpenStorageDirectory?: () => void | Promise<unknown>;
}) {
  const mainView = mainViewFor(activeView);
  const web = exploreState.browserMode === "web";
  const protectionBypassed = !web && exploreState.protectionStatus === "bypassed";
  const protectionReady = Boolean(status?.visionReady && status.modelBacked && !protectionBypassed);
  return (
    <aside className="sidebar">
      <div
        className="brand-row"
        role="button"
        tabIndex={0}
        title="点击前往设置中心更换头像与个性化主题"
        onClick={() => onOpenSettings("appearance")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenSettings("appearance");
          }
        }}
      >
        {appearance.customAvatarUrl ? (
          <img src={appearance.customAvatarUrl} alt="User Avatar" className="user-avatar-mark" />
        ) : (
          <div className="brand-mark">DS</div>
        )}
        <div className="brand-copy">
          <strong>纯净领域</strong>
          <span>Digital Sanctuary</span>
        </div>
      </div>


      {onQuickActions && <button type="button" className="sidebar-quick-actions" onClick={onQuickActions} title="快捷操作 (Ctrl+K)">
        <span>⌕ 快捷操作</span><kbd>Ctrl K</kbd>
      </button>}
      {onOpenTasks && <button type="button" className="sidebar-task-entry" aria-label="任务与进度" onClick={onOpenTasks}>
        <span>任务与进度</span><span>{taskCount > 0 ? `${taskCount} 项待完成` : "查看"}</span>
      </button>}
      <nav aria-label="主导航">
        {MAIN_NAVIGATION.map((item) => (
          <button
            key={item.id}
            aria-current={mainView === item.id ? "page" : undefined}
            className={`nav-item ${mainView === item.id ? "active" : ""}`}
            data-nav={item.id}
            onClick={() => item.id === "gallery" ? void onOpenGallery() : onViewChange(item.id)}
          >
            <span className="nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
          </button>
        ))}
      </nav>

      {activeView === "explore" && !web && (
        <section className="explore-sidebar-actions">
          <p className="sidebar-section-label">保存到本地</p>
          <button
            className="explore-action primary-action"
            disabled={exploreState.pageKind !== "artwork" || downloadBusy}
            onClick={() => void onDownloadCurrentArtwork()}
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
            onClick={() => void onPreviewBookmarks()}
          >
            <strong>下载全部收藏</strong>
            <small>
              {exploreState.pageKind === "bookmarks"
                ? "先预览范围，再开始下载"
                : "进入收藏作品页后可用"}
            </small>
          </button>
          <div className="download-storage-bar" title={storageLocation?.effectivePath ?? "图片 → Digital Sanctuary → Pixiv"}>
            <div className="storage-bar-text">
              <span className="storage-drive-tag">{storageLocation?.driveRoot ? `${storageLocation.driveRoot}` : "默认"}</span>
              <span className="storage-path-summary">
                {storageLocation?.effectivePath ? storageLocation.effectivePath : "图片 → Digital Sanctuary → Pixiv"}
              </span>
            </div>
            <div className="storage-bar-actions">
              <button
                type="button"
                className="storage-bar-btn"
                title="在系统文件管理器中打开保存文件夹"
                onClick={() => void onOpenStorageDirectory?.()}
              >
                打开
              </button>
              <button
                type="button"
                className="storage-bar-btn"
                title="更改保存盘符或目录"
                onClick={() => void onChooseDownloadDirectory?.()}
              >
                更改
              </button>
            </div>
          </div>
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
      <button type="button" className="engine-card" onClick={() => protectionBypassed ? onViewChange("explore") : onOpenSettings("protection")} title={protectionBypassed ? "进入探索恢复保护" : "查看探索保护设置"}>
        <span className={`status-dot ${protectionReady ? "online" : ""}`} />
        <div>
          <strong>{web ? "Pixiv 浏览保护" : protectionBypassed ? "本次无保护浏览" : protectionReady ? "探索保护已就绪" : status?.visionState === "starting" || !status ? "探索保护准备中" : "探索保护需检查"}</strong>
          <small>{web ? "当前网站尚未适配元素拦截" : protectionBypassed ? "点击进入探索恢复保护" : "管理过滤规则与个人偏好"}</small>
        </div>
      </button>
    </aside>
  );
}
