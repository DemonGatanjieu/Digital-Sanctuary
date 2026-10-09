import type { AppearancePreferences } from "@sanctuary/domain";
import type { ExploreState } from "../../preload/index";
import { Icon, type IconName } from "./Icon";
import { MAIN_NAVIGATION, type ActiveView, type SettingsSection } from "./app-navigation";
export type { ActiveView } from "./app-navigation";

export interface AppStatus {
  visionEngine: string;
  visionProvider: string;
  visionReady: boolean;
  visionState: "starting" | "ready" | "failed" | "stopped";
  visionError: string;
  modelBacked: boolean;
}

/** Compact icon rail. Labels stay visible under each icon; details live in tooltips. */
export function AppSidebar({
  activeView,
  exploreState,
  appearance,
  status,
  onOpenGallery,
  onQuickActions,
  onOpenTasks,
  taskCount = 0,
  onViewChange,
  onOpenSettings
}: {
  activeView: ActiveView;
  exploreState: ExploreState;
  appearance: AppearancePreferences;
  status: AppStatus | null;
  onOpenGallery: () => void | Promise<void>;
  onQuickActions?: () => void;
  onOpenTasks?: () => void;
  taskCount?: number;
  onViewChange: (view: ActiveView) => void;
  onOpenSettings: (section: SettingsSection) => void;
}) {
  const web = exploreState.browserMode === "web";
  const protectionBypassed = !web && exploreState.protectionStatus === "bypassed";
  const protectionReady = Boolean(status?.visionReady && status.modelBacked && !protectionBypassed);
  const protectionLabel = web ? "当前网站尚未适配元素拦截"
    : protectionBypassed ? "本次无保护浏览 · 点击进入探索恢复保护"
    : protectionReady ? "探索保护已就绪"
    : status?.visionState === "starting" || !status ? "探索保护准备中" : "探索保护需检查";
  return (
    <aside className="app-rail" aria-label="主导航">
      <button
        type="button"
        className="rail-brand"
        data-nav="home"
        aria-current={activeView === "home" ? "page" : undefined}
        title="开始"
        aria-label="开始"
        onClick={() => onViewChange("home")}
      >
        {appearance.customAvatarUrl ? <img src={appearance.customAvatarUrl} alt="" /> : <span>纯</span>}
      </button>

      <nav className="rail-nav">
        {MAIN_NAVIGATION.map((item) => (
          <RailButton
            key={item.id}
            id={item.id}
            icon={item.icon}
            label={item.label}
            title={item.description}
            current={activeView === item.id}
            onClick={() => item.id === "gallery" ? void onOpenGallery() : onViewChange(item.id)}
          />
        ))}
      </nav>

      <div className="rail-spacer" />

      {onQuickActions && <RailButton icon="command" label="快捷" title="快捷操作 (Ctrl+K)" onClick={onQuickActions} />}
      {onOpenTasks && (
        <RailButton icon="tasks" label="任务" title={taskCount > 0 ? `任务与进度 · ${taskCount} 项进行中` : "任务与进度"} ariaLabel="任务与进度" onClick={onOpenTasks}
          badge={taskCount > 0 ? String(taskCount) : undefined} />
      )}
      <button
        type="button"
        className="rail-item rail-protection"
        aria-label={protectionLabel}
        title={protectionLabel}
        onClick={() => protectionBypassed ? onViewChange("explore") : onOpenSettings("protection")}
      >
        <span className="rail-icon">
          <Icon name="shield" size={20} />
          <span className={`status-dot ${protectionReady ? "online" : protectionBypassed || status?.visionState === "failed" ? "warning" : ""}`} />
        </span>
        <span className="rail-label">保护</span>
      </button>
      <RailButton id="settings" icon="settings" label="设置" title="外观、存储与模型" current={activeView === "settings"} onClick={() => onViewChange("settings")} />
    </aside>
  );
}

function RailButton({ id, icon, label, title, ariaLabel, current = false, badge, onClick }: {
  id?: string;
  icon: IconName;
  label: string;
  title: string;
  ariaLabel?: string;
  current?: boolean;
  badge?: string | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rail-item"
      data-nav={id}
      aria-current={current ? "page" : undefined}
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
    >
      <span className="rail-icon">
        <Icon name={icon} size={20} />
        {badge && <span className="rail-badge">{badge}</span>}
      </span>
      <span className="rail-label">{label}</span>
    </button>
  );
}
