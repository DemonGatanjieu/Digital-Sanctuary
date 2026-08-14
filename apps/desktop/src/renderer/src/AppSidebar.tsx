import type { AppearancePreferences } from "@sanctuary/domain";
import type { ExploreState } from "../../preload/index";
import { downloadPhaseLabel } from "./ExploreView";
import { SegmentedControl } from "./SegmentedControl";

export interface AppStatus {
  visionEngine: string;
  visionProvider: string;
  visionReady: boolean;
  modelBacked: boolean;
}

export type ActiveView = "gallery" | "organize" | "explore" | "settings";

export function AppSidebar({
  activeView,
  exploreState,
  downloadBusy,
  appearance,
  status,
  onOpenGallery,
  onViewChange,
  onDownloadCurrentArtwork,
  onPreviewBookmarks,
  onAppearanceChange
}: {
  activeView: ActiveView;
  exploreState: ExploreState;
  downloadBusy: boolean;
  appearance: AppearancePreferences;
  status: AppStatus | null;
  onOpenGallery: () => void | Promise<void>;
  onViewChange: (view: ActiveView) => void;
  onDownloadCurrentArtwork: () => void | Promise<void>;
  onPreviewBookmarks: () => void | Promise<void>;
  onAppearanceChange: (appearance: AppearancePreferences) => void | Promise<void>;
}) {
  return (
    <aside className="sidebar">
      <div className="brand-mark">DS</div>
      <div className="brand-copy">
        <strong>纯净领域</strong>
        <span>Digital Sanctuary</span>
      </div>

      <nav>
        <button aria-current={activeView === "gallery" ? "page" : undefined} className={`nav-item ${activeView === "gallery" ? "active" : ""}`} data-nav="gallery" onClick={() => void onOpenGallery()}>
          画廊
        </button>
        <button aria-current={activeView === "organize" ? "page" : undefined} className={`nav-item ${activeView === "organize" ? "active" : ""}`} data-nav="organize" onClick={() => onViewChange("organize")}>
          模型整理
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
