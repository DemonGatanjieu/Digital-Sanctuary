import { useEffect, useState, type ReactNode } from "react";
import {
  type AppearancePreferences,
  type LibraryPreferences,
  type StorageLocationInfo,
  type StorageMigrationResult
} from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import { Button } from "./Button";
import { VisionSettingsSection } from "./VisionSettingsSection";
import { ComfyUiSettingsSection } from "./ComfyUiSettingsSection";
import { ModelCenterView } from "./ModelCenterView";
import { SegmentedControl } from "./SegmentedControl";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { Icon } from "./Icon";
import { SETTINGS_SECTIONS, restoreDefaultDownloadLocation, type SettingsSection } from "./app-navigation";

interface SettingsViewProps {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onError: (error: unknown) => void;
  appearance: AppearancePreferences;
  libraryPreferences: LibraryPreferences;
  error: string;
  onOpenProtection: () => void;
  modelBusy?: boolean;
  onModelBusyChange?: (busy: boolean) => void;
  storageLocation?: StorageLocationInfo | null;
  onAppearanceChange: (preferences: AppearancePreferences) => Promise<void>;
  onLibraryPreferencesChange: (preferences: LibraryPreferences) => Promise<void>;
  onChooseDownloadDirectory: () => Promise<unknown>;
  onOpenStorageDirectory?: () => Promise<boolean>;
  onMigrateStorage?: () => Promise<StorageMigrationResult>;
  onCreateBackup: () => Promise<string | null>;
}

const DISPLAY_PROFILES = [
  ["quality", "精致", "完整过渡与更丰富的层次。"],
  ["balanced", "均衡", "日常推荐，减少合成效果。"],
  ["efficient", "省电", "减少动画与阴影。"]
] as const;

export function SettingsView({
  section,
  onSectionChange,
  onError,
  appearance,
  libraryPreferences,
  error,
  storageLocation,
  onAppearanceChange,
  onLibraryPreferencesChange,
  onChooseDownloadDirectory,
  onOpenStorageDirectory,
  onMigrateStorage,
  onCreateBackup,
  onOpenProtection,
  modelBusy = false,
  onModelBusyChange = () => undefined
}: SettingsViewProps) {
  const [migrating, setMigrating] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  const [storageFailed, setStorageFailed] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const currentSection = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0];

  return (
    <>
      <header className="view-header settings-header">
        <h1>设置</h1>
        <nav className="ui-segmented settings-navigation" aria-label="设置分类">
          {SETTINGS_SECTIONS.map((item) => (
            <button key={item.id} type="button" data-settings={item.id} className={section === item.id ? "active" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => onSectionChange(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <button type="button" className="ui-tool-button settings-protection-link" onClick={onOpenProtection} title="浏览保护在探索页调整"><Icon name="shield" size={16} /><span>浏览保护</span></button>
      </header>
      {error && <AppNotice tone="error">{error}</AppNotice>}
      <p className="settings-section-intro">{currentSection.description}</p>
      <SettingsPanel active={section === "models"}><ModelCenterView embedded onError={onError} disabled={modelBusy} onBusyChange={onModelBusyChange} /></SettingsPanel>
      <SettingsPanel active={section === "connections"}>
        <SettingsDisclosure name="external-vision" title="外部画评服务" description="按需连接云端视觉模型。"><VisionSettingsSection /></SettingsDisclosure>
        <SettingsDisclosure name="comfyui" title="ComfyUI 绘图连接" description="连接本机服务和工作流。"><ComfyUiSettingsSection /></SettingsDisclosure>
      </SettingsPanel>
      <SettingsPanel active={section === "appearance"}>
      <section className="appearance-settings-card">
        <div className="settings-row">
          <span><strong>配色</strong><small>跟随系统时，随 Windows 的浅色 / 深色设置切换。</small></span>
          <SegmentedControl label="配色" value={appearance.colorScheme ?? "system"}
            options={[{ value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }]}
            onChange={(colorScheme) => void onAppearanceChange({ ...appearance, colorScheme })} />
        </div>
        <div className="settings-row">
          <span><strong>显示档位</strong><small>{DISPLAY_PROFILES.find(([profile]) => profile === appearance.displayProfile)?.[2]}</small></span>
          <SegmentedControl label="显示档位" value={appearance.displayProfile}
            options={DISPLAY_PROFILES.map(([value, label, title]) => ({ value, label, title }))}
            onChange={(displayProfile) => void onAppearanceChange({ ...appearance, displayProfile })} />
        </div>
        <div className="settings-row">
          <span><strong>界面字体</strong><small>宋体会优先使用已安装的思源宋体。</small></span>
          <SegmentedControl label="界面字体" value={appearance.interfaceFont ?? "default"}
            options={[{ value: "default", label: "默认" }, { value: "dengxian", label: "等线" }, { value: "songti", label: "宋体" }]}
            onChange={(interfaceFont) => void onAppearanceChange({ ...appearance, interfaceFont })} />
        </div>
        <label className="settings-row">
          <span><strong>减少动态效果</strong><small>关闭位移、缩放和非必要的动画。</small></span>
          <input type="checkbox" checked={appearance.reducedMotion} onChange={(event) => void onAppearanceChange({ ...appearance, reducedMotion: event.target.checked })} />
        </label>
      </section>
      <SettingsDisclosure name="avatar" title="个人头像" description="显示在侧栏左上角。">
        <div className="user-avatar-setting-row">
          <div className="user-avatar-preview-box">
            {appearance.customAvatarUrl ? (
              <img src={appearance.customAvatarUrl} alt="当前头像" className="avatar-preview-img" />
            ) : (
              <div className="avatar-placeholder-brand">DS</div>
            )}
          </div>
          <div className="user-avatar-actions">
            <label className="button variant-secondary avatar-upload-button">
              <span>选择图片</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === "string") void onAppearanceChange({ ...appearance, customAvatarUrl: reader.result });
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {appearance.customAvatarUrl && (
              <Button variant="ghost" onClick={() => void onAppearanceChange({ ...appearance, customAvatarUrl: null })}>恢复默认</Button>
            )}
            <small className="avatar-hint">PNG、JPEG、WebP 或 GIF。</small>
          </div>
        </div>
      </SettingsDisclosure>
      </SettingsPanel>
      <SettingsPanel active={section === "library"}>
      <section className="library-preferences-card">
        <PreferenceSelect label="默认视图" value={libraryPreferences.defaultView} onChange={(value) => void onLibraryPreferencesChange({ ...libraryPreferences, defaultView: value as LibraryPreferences["defaultView"] })} options={[["flat", "全部作品"], ["collections", "相册"], ["author-work", "画师"]]} />
        <PreferenceSelect label="默认排序" value={libraryPreferences.defaultSortBy} onChange={(value) => void onLibraryPreferencesChange({ ...libraryPreferences, defaultSortBy: value as LibraryPreferences["defaultSortBy"] })} options={[["savedAt", "保存时间"], ["publishedAt", "发布时间"], ["title", "标题"], ["artist", "作者"], ["pageCount", "页数"], ["byteLength", "大小"]]} />
        <PreferenceSelect label="排序方向" value={libraryPreferences.defaultSortDirection} onChange={(value) => void onLibraryPreferencesChange({ ...libraryPreferences, defaultSortDirection: value as "asc" | "desc" })} options={[["desc", "降序"], ["asc", "升序"]]} />
        <PreferenceSelect label="网格密度" value={libraryPreferences.gridDensity} onChange={(value) => void onLibraryPreferencesChange({ ...libraryPreferences, gridDensity: value as "comfortable" | "compact" })} options={[["comfortable", "舒适"], ["compact", "紧凑"]]} />
        <div className="storage-preference-card">
          <div className="storage-info-header">
            <div className="storage-path-block">
              <span className="storage-title">Pixiv 照片保存路径与磁盘</span>
              <p className="storage-path-text" title={storageLocation?.effectivePath ?? libraryPreferences.downloadDirectory ?? "系统图片 / Digital Sanctuary / Pixiv"}>
                {storageLocation?.effectivePath ?? libraryPreferences.downloadDirectory ?? "系统图片 / Digital Sanctuary / Pixiv"}
              </p>

            </div>
            <div className="storage-meta-badges">
              <span className="storage-badge drive-badge">
                {storageLocation?.driveRoot ? `磁盘 ${storageLocation.driveRoot}` : "系统盘"}
              </span>
              {storageLocation?.freeBytes !== null && storageLocation?.freeBytes !== undefined && (
                <span className="storage-badge space-badge">
                  可用 {(storageLocation.freeBytes / (1024 ** 3)).toFixed(1)} GB
                  {storageLocation.totalBytes ? ` / ${(storageLocation.totalBytes / (1024 ** 3)).toFixed(1)} GB` : ""}
                </span>
              )}
              <span className="storage-badge type-badge">
                {libraryPreferences.downloadDirectory ? "自定义存储盘" : "系统默认目录"}
              </span>
            </div>
          </div>

          <div className="storage-action-row">
            <Button disabled={migrating} onClick={() => void onChooseDownloadDirectory().catch(onError)}>更改存储盘 / 目录</Button>
            <Button variant="secondary" onClick={() => void onOpenStorageDirectory?.()}>在资源管理器中打开</Button>

            <Button variant="ghost" disabled={migrating} onClick={() => void onLibraryPreferencesChange(restoreDefaultDownloadLocation(libraryPreferences))}>恢复默认位置</Button>
          </div>
          <SettingsDisclosure name="storage-maintenance" title="备份与迁移" description={storageLocation?.migratableArtworkCount ? `${storageLocation.migratableArtworkCount} 件作品可迁移到此目录` : "备份图库数据库，或整理历史存储位置。"}>
          {storageLocation && storageLocation.migratableArtworkCount > 0 && (
            <div className="storage-migratable-banner">
              <div className="storage-migratable-text">
                <span>旧默认目录中还有 <strong>{storageLocation.migratableArtworkCount}</strong> 张已索引图片。</span>
                <small>复制并校验图片和头像后更新图库路径，原文件保留。生成图片、备份和导出仍在原处；确认新位置正常后再清理旧副本。</small>
              </div>
              <Button
                variant="primary"
                size="small"
                busy={migrating}
                busyLabel="正在迁移照片..."
                onClick={async () => {
                  try {
                    setMigrating(true);
                    setStorageFailed(false);
                    const res = await onMigrateStorage?.();
                    if (res) {
                      setStorageMessage(`已复制并更新 ${res.migratedAssets} 张图片、${res.migratedAvatars} 个头像。原文件已保留；请先检查新位置再清理旧副本。`);
                    }
                  } catch (e) {
                    setStorageFailed(true);
                    setStorageMessage(`迁移失败: ${e instanceof Error ? e.message : String(e)}`);
                  } finally {
                    setMigrating(false);
                  }
                }}
              >
                复制旧目录图片至此
              </Button>
            </div>
          )}

            <Button variant="secondary" onClick={() => void onCreateBackup().then((path) => path && setBackupMessage(`备份已保存到 ${path}`))}>备份数据库</Button>
          </SettingsDisclosure>
          {storageMessage && (
            <AppNotice className="storage-notice" tone={storageFailed ? "error" : "success"} onDismiss={() => setStorageMessage("")}>
              {storageMessage}
            </AppNotice>
          )}
        </div>
        {backupMessage && <AppNotice className="storage-backup-notice" tone="success" onDismiss={() => setBackupMessage("")}>{backupMessage}</AppNotice>}
      </section>
      </SettingsPanel>
      <SettingsPanel active={section === "protection"}><Button onClick={onOpenProtection}>在探索管理浏览保护</Button></SettingsPanel>
    </>
  );
}

// Load a category on first visit and keep its drafts while switching categories.
function SettingsPanel({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  if (!active && !visited) return null;
  return <div className="settings-panel" hidden={!active}>{children}</div>;
}

function PreferenceSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}
