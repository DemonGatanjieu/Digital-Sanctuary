import type { AppearancePreferences, StorageLocationInfo } from "@sanctuary/domain";
import type { ExploreState } from "../../preload/index";
import { downloadPhaseLabel } from "./ExploreView";
import { SegmentedControl } from "./SegmentedControl";

export interface AppStatus {
  visionEngine: string;
  visionProvider: string;
  visionReady: boolean;
  visionState: "starting" | "ready" | "failed" | "stopped";
  visionError: string;
  modelBacked: boolean;
}

export type ActiveView = "gallery" | "organize" | "models" | "inspiration" | "explore" | "settings";

export function AppSidebar({
  activeView,
  exploreState,
  downloadBusy,
  appearance,
  status,
  storageLocation,
  onOpenGallery,
  onViewChange,
  onDownloadCurrentArtwork,
  onPreviewBookmarks,
  onAppearanceChange,
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
  onViewChange: (view: ActiveView) => void;
  onDownloadCurrentArtwork: () => void | Promise<void>;
  onPreviewBookmarks: () => void | Promise<void>;
  onAppearanceChange: (appearance: AppearancePreferences) => void | Promise<void>;
  onChooseDownloadDirectory?: () => void | Promise<unknown>;
  onOpenStorageDirectory?: () => void | Promise<unknown>;
}) {
  return (
    <aside className="sidebar">
      <div
        className="brand-row"
        role="button"
        tabIndex={0}
        title="点击前往设置中心更换头像与个性化主题"
        onClick={() => onViewChange("settings")}
        onKeyDown={(e) => e.key === "Enter" && onViewChange("settings")}
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


      <nav>
        <button aria-current={activeView === "gallery" ? "page" : undefined} className={`nav-item ${activeView === "gallery" ? "active" : ""}`} data-nav="gallery" onClick={() => void onOpenGallery()}>
          画廊
        </button>
        <button aria-current={activeView === "organize" ? "page" : undefined} className={`nav-item ${activeView === "organize" ? "active" : ""}`} data-nav="organize" title="智能清洗排查与模型整理工坊" onClick={() => onViewChange("organize")}>
          智能工坊
        </button>
        <button aria-current={activeView === "models" ? "page" : undefined} className={`nav-item ${activeView === "models" ? "active" : ""}`} data-nav="models" onClick={() => onViewChange("models")}>
          模型中心
        </button>
        <button aria-current={activeView === "inspiration" ? "page" : undefined} className={`nav-item ${activeView === "inspiration" ? "active" : ""}`} data-nav="inspiration" title="使用当前本地模型读图、聊天和辅助创作" onClick={() => onViewChange("inspiration")}>
          本地灵感台
        </button>
        <button aria-current={activeView === "explore" ? "page" : undefined} className={`nav-item ${activeView === "explore" ? "active" : ""}`} data-nav="explore" onClick={() => onViewChange("explore")}>
          探索
        </button>
        <button aria-current={activeView === "settings" ? "page" : undefined} className={`nav-item ${activeView === "settings" ? "active" : ""}`} data-nav="settings" onClick={() => onViewChange("settings")}>
          设置
        </button>
      </nav>

      {activeView === "explore" && (
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
                ? "用户信任 · 不执行 AI 审查"
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
      <section className="display-profile-control" aria-label="显示性能档位">
        <div>
          <span>显示档位</span>
          <small>{appearance.displayProfile === "quality" ? "完整氛围" : appearance.displayProfile === "balanced" ? "日常推荐" : "减少特效"}</small>
        </div>
        <SegmentedControl
          compact
          label="显示性能档位"
          value={appearance.displayProfile}
          options={[
            { value: "quality", label: "精", title: "精致" },
            { value: "balanced", label: "衡", title: "均衡" },
            { value: "efficient", label: "省", title: "省电" }
          ]}
          onChange={(profile) => void onAppearanceChange({ ...appearance, displayProfile: profile })}
        />
      </section>
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
  );
}
