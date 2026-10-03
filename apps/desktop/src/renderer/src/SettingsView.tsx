import { useEffect, useState, type ReactNode } from "react";
import {
  type AppearancePreferences,
  type LibraryPreferences,
  type StorageLocationInfo,
  type StorageMigrationResult
} from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import { Button } from "./Button";
import { ThemeSettingsSection } from "./ThemeSettingsSection";
import { TypographySettingsSection } from "./typography/TypographySettingsSection";
import { VisionSettingsSection } from "./VisionSettingsSection";
import { ComfyUiSettingsSection } from "./ComfyUiSettingsSection";
import { ModelCenterView } from "./ModelCenterView";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { InteractiveCompassDial } from "./InteractiveCompassDial";
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
  const [backupMessage, setBackupMessage] = useState("");
  const currentSection = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0];

  return (
    <>
      <header className="topbar rules-heading">
        <div>
          <p className="eyebrow">PREFERENCES</p>
          <h1>设置</h1>
          <p className="page-description">应用偏好。浏览保护可在探索页直接调整。</p>
        </div>
        <Button variant="secondary" onClick={onOpenProtection}>在探索调整浏览保护 →</Button>
      </header>
      {error && <AppNotice tone="error">{error}</AppNotice>}
      <nav className="settings-navigation" aria-label="设置分类">
        {SETTINGS_SECTIONS.map((item) => (
          <button key={item.id} type="button" data-settings={item.id} aria-current={section === item.id ? "page" : undefined} onClick={() => onSectionChange(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="settings-section-intro">
        <h2>{currentSection.label}</h2>
        <p>{currentSection.description}</p>
      </div>
      <SettingsPanel active={section === "models"}><ModelCenterView embedded onError={onError} disabled={modelBusy} onBusyChange={onModelBusyChange} /></SettingsPanel>
      <SettingsPanel active={section === "connections"}>
        <SettingsDisclosure name="external-vision" title="外部画评服务" description="按需连接云端视觉模型。"><VisionSettingsSection /></SettingsDisclosure>
        <SettingsDisclosure name="comfyui" title="ComfyUI 绘图连接" description="连接本机服务和工作流。"><ComfyUiSettingsSection /></SettingsDisclosure>
      </SettingsPanel>
      <SettingsPanel active={section === "appearance"}>
      <ThemeSettingsSection />
      <SettingsDisclosure name="theme-dial" title="主题拨盘" description="用拨盘切换内置主题。"><section className="appearance-theme-dial">
        <div><h3>拨盘切换主题</h3><p>拖动罗盘，切换四套内置主题。</p></div>
        <InteractiveCompassDial mode="hero" />
      </section></SettingsDisclosure>
      <SettingsDisclosure name="avatar" title="个人头像" description="选择显示在侧栏的图片。"><section className="user-profile-card">
        <header>
          <div>
            <p className="eyebrow">IDENTITY & PROFILE</p>
            <h2>个人头像设置</h2>
          </div>
          <span>显示在左侧导航栏与专属控制台</span>
        </header>
        <div className="user-avatar-setting-row">
          <div className="user-avatar-preview-box">
            {appearance.customAvatarUrl ? (
              <img src={appearance.customAvatarUrl} alt="Avatar Preview" className="avatar-preview-img" />
            ) : (
              <div className="avatar-placeholder-brand">DS</div>
            )}
          </div>
          <div className="user-avatar-actions">
            <label className="button variant-secondary avatar-upload-button">
              <span>🖼️ 选择本地图片作为头像</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const result = reader.result;
                    if (typeof result === "string") {
                      void onAppearanceChange({ ...appearance, customAvatarUrl: result });
                    }
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {appearance.customAvatarUrl && (
              <Button
                variant="ghost"
                onClick={() => void onAppearanceChange({ ...appearance, customAvatarUrl: null })}
              >
                恢复默认品牌图标
              </Button>
            )}
            <small className="avatar-hint">支持 PNG、JPEG、WebP、GIF 格式图片，自动适配并持久化保存。</small>
          </div>
        </div>
      </section></SettingsDisclosure>

      <section className="appearance-settings-card">
        <header>
          <div><p className="eyebrow">APPEARANCE</p><h2>外观与性能</h2></div>
          <span>功能位置不会随档位改变</span>
        </header>
        <div className="appearance-profile-options">
          {([
            ["quality", "精致", "环境作品、完整过渡与更丰富层次"],
            ["balanced", "均衡", "日常推荐，保留静态氛围并减少合成"],
            ["efficient", "省电", "不加载环境作品，减少动画与阴影"]
          ] as const).map(([profile, label, detail]) => (
            <button
              key={profile}
              type="button"
              className={appearance.displayProfile === profile ? "active" : ""}
              onClick={() => void onAppearanceChange({ ...appearance, displayProfile: profile })}
            >
              <span>{appearance.displayProfile === profile ? "✓" : ""}</span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </button>
          ))}
        </div>
        <div className="appearance-toggle-row">
          <label>
            <span><strong>作品环境展示</strong><small>使用最近作品修饰画廊顶部；省电档始终关闭。</small></span>
            <input type="checkbox" checked={appearance.ambientArtwork} onChange={(event) => void onAppearanceChange({ ...appearance, ambientArtwork: event.target.checked })} />
          </label>
          <label>
            <span><strong>减少动态效果</strong><small>关闭位移、缩放和非必要动画。</small></span>
            <input type="checkbox" checked={appearance.reducedMotion} onChange={(event) => void onAppearanceChange({ ...appearance, reducedMotion: event.target.checked })} />
          </label>
        </div>
      </section>
      <SettingsDisclosure name="typography" title="字体与排版" description="默认字体已配置；需要时再自定义。"><TypographySettingsSection /></SettingsDisclosure>
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
            <Button onClick={() => void onChooseDownloadDirectory()}>更改存储盘 / 目录</Button>
            <Button variant="secondary" onClick={() => void onOpenStorageDirectory?.()}>在资源管理器中打开</Button>

            <Button variant="ghost" onClick={() => void onLibraryPreferencesChange(restoreDefaultDownloadLocation(libraryPreferences))}>恢复默认位置</Button>
          </div>
          <SettingsDisclosure name="storage-maintenance" title="备份与迁移" description={storageLocation?.migratableArtworkCount ? `${storageLocation.migratableArtworkCount} 件作品可迁移到此目录` : "备份图库数据库，或整理历史存储位置。"}>
          {storageLocation && storageLocation.migratableArtworkCount > 0 && (
            <div className="storage-migratable-banner">
              <div className="storage-migratable-text">
                <span>提示：图库中有 <strong>{storageLocation.migratableArtworkCount}</strong> 部作品保存在其他目录或旧磁盘中。</span>
                <small>点击一键迁移可将所有历史照片合并移动至当前选择的存储盘，并自动释放原磁盘空间。</small>
              </div>
              <Button
                variant="primary"
                size="small"
                busy={migrating}
                busyLabel="正在迁移照片..."
                onClick={async () => {
                  try {
                    setMigrating(true);
                    const res = await onMigrateStorage?.();
                    if (res) {
                      setStorageMessage(`已成功迁移 ${res.migratedArtworks} 部作品（共 ${res.migratedAssets} 张照片）至当前存储盘！`);
                    }
                  } catch (e) {
                    setStorageMessage(`迁移失败: ${e instanceof Error ? e.message : String(e)}`);
                  } finally {
                    setMigrating(false);
                  }
                }}
              >
                一键迁移已有照片至此
              </Button>
            </div>
          )}

            <Button variant="secondary" onClick={() => void onCreateBackup().then((path) => path && setBackupMessage(`备份已保存到 ${path}`))}>备份数据库</Button>
          </SettingsDisclosure>
          {storageMessage && (
            <AppNotice className="storage-notice" tone="success" onDismiss={() => setStorageMessage("")}>
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
