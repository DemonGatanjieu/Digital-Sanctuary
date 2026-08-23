import { useMemo, useState } from "react";
import {
  DEFAULT_LIBRARY_PREFERENCES,
  ELEMENT_BLACKLIST_GROUPS,
  type AppearancePreferences,
  type CustomElementGroup,
  type ElementFilterSetting,
  type LibraryPreferences,
  type RuleSandboxResult
} from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import type { AppStatus } from "./AppSidebar";
import { Button } from "./Button";
import { ThemeSettingsSection } from "./ThemeSettingsSection";
import { TypographySettingsSection } from "./typography/TypographySettingsSection";
import { VisionSettingsSection } from "./VisionSettingsSection";

interface SettingsViewProps {
  settings: ElementFilterSetting[];
  appearance: AppearancePreferences;
  libraryPreferences: LibraryPreferences;
  customGroups: CustomElementGroup[];
  status: AppStatus | null;
  savingGroupId: string;
  error: string;
  onEdit: (setting: ElementFilterSetting) => void;
  onSave: (setting: ElementFilterSetting) => void;
  onAppearanceChange: (preferences: AppearancePreferences) => Promise<void>;
  onLibraryPreferencesChange: (preferences: LibraryPreferences) => Promise<void>;
  onChooseDownloadDirectory: () => Promise<void>;
  onCreateBackup: () => Promise<string | null>;
  onCustomGroupsChange: (groups: CustomElementGroup[]) => Promise<void>;
}

export function SettingsView({
  settings,
  appearance,
  libraryPreferences,
  customGroups,
  status,
  savingGroupId,
  error,
  onEdit,
  onSave,
  onAppearanceChange,
  onLibraryPreferencesChange,
  onChooseDownloadDirectory,
  onCreateBackup,
  onCustomGroupsChange
}: SettingsViewProps) {
  const [customName, setCustomName] = useState("");
  const [customTags, setCustomTags] = useState("");
  const [customAliases, setCustomAliases] = useState("");
  const [customAction, setCustomAction] = useState<"blur" | "hide">("hide");
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [sandboxResult, setSandboxResult] = useState<RuleSandboxResult | null>(null);
  const [backupMessage, setBackupMessage] = useState("");
  const elementGroups = useMemo(() => [...ELEMENT_BLACKLIST_GROUPS, ...customGroups], [customGroups]);

  async function createCustomGroup() {
    const tags = splitLabels(customTags);
    if (!customName.trim() || tags.length === 0) return;
    await onCustomGroupsChange([
      ...customGroups,
      {
        id: `custom-${crypto.randomUUID()}`,
        name: customName.trim(),
        description: "用户自定义元素组",
        tags,
        aliases: splitLabels(customAliases),
        defaultThreshold: 0.35,
        action: customAction
      }
    ]);
    setCustomName("");
    setCustomTags("");
    setCustomAliases("");
  }

  async function testImage() {
    setSandboxBusy(true);
    try {
      setSandboxResult(await window.sanctuary.testFilterImage());
    } finally {
      setSandboxBusy(false);
    }
  }

  return (
    <>
      <header className="topbar rules-heading">
        <div>
          <p className="eyebrow">PREFERENCES</p>
          <h1>设置</h1>
          <p className="page-description">调整画廊呈现、存储位置和探索空间的元素拦截。</p>
        </div>
      </header>
      {error && <AppNotice tone="error">{error}</AppNotice>}

      <ThemeSettingsSection />
      <TypographySettingsSection />
      <VisionSettingsSection />

      <section className="user-profile-card">
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
      </section>

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

      <SectionHeading eyebrow="LIBRARY DEFAULTS" title="画廊与存储" description="只改变默认呈现和保存位置，不改变内容信任边界。" />
      <section className="library-preferences-card">
        <PreferenceSelect label="默认视图" value={libraryPreferences.defaultView} onChange={(value) => void onLibraryPreferencesChange({ ...libraryPreferences, defaultView: value as LibraryPreferences["defaultView"] })} options={[["flat", "平铺"], ["collections", "分类"], ["author-work", "作者 · 作品"]]} />
        <PreferenceSelect label="默认排序" value={libraryPreferences.defaultSortBy} onChange={(value) => void onLibraryPreferencesChange({ ...libraryPreferences, defaultSortBy: value as LibraryPreferences["defaultSortBy"] })} options={[["savedAt", "保存时间"], ["publishedAt", "发布时间"], ["title", "标题"], ["artist", "作者"], ["pageCount", "页数"], ["byteLength", "大小"]]} />
        <PreferenceSelect label="排序方向" value={libraryPreferences.defaultSortDirection} onChange={(value) => void onLibraryPreferencesChange({ ...libraryPreferences, defaultSortDirection: value as "asc" | "desc" })} options={[["desc", "降序"], ["asc", "升序"]]} />
        <PreferenceSelect label="网格密度" value={libraryPreferences.gridDensity} onChange={(value) => void onLibraryPreferencesChange({ ...libraryPreferences, gridDensity: value as "comfortable" | "compact" })} options={[["comfortable", "舒适"], ["compact", "紧凑"]]} />
        <div className="storage-preference">
          <span><strong>Pixiv 保存目录</strong><small>{libraryPreferences.downloadDirectory ?? "系统图片 / Digital Sanctuary / Pixiv"}</small></span>
          <Button onClick={() => void onChooseDownloadDirectory()}>选择目录</Button>
          <Button onClick={() => void onCreateBackup().then((path) => path && setBackupMessage(`备份已保存到 ${path}`))}>备份数据库</Button>
          <Button variant="ghost" onClick={() => void onLibraryPreferencesChange(DEFAULT_LIBRARY_PREFERENCES)}>恢复画廊默认值</Button>
        </div>
        {backupMessage && <AppNotice className="storage-backup-notice" tone="success" onDismiss={() => setBackupMessage("")}>{backupMessage}</AppNotice>}
      </section>

      <SectionHeading eyebrow="ELEMENT BLACKLIST" title="元素拦截规则" description="只控制不受欢迎的画面元素；R18、裸露和露骨程度不参与拦截。" />
      <section className="rules-grid">
        {elementGroups.map((group) => {
          const setting = settings.find((item) => item.groupId === group.id) ?? {
            groupId: group.id,
            enabled: true,
            minimumConfidence: group.defaultThreshold
          };
          return (
            <article className={`rule-card ${setting.enabled ? "enabled" : "disabled"}`} key={group.id}>
              <div className="rule-card-header">
                <div><span className="rule-state">{setting.enabled ? "正在拦截" : "已停用"}</span><h2>{group.name}</h2><p>{group.description}</p></div>
                <label className="switch" title={`切换${group.name}`}><input type="checkbox" checked={setting.enabled} onChange={(event) => onEdit({ ...setting, enabled: event.target.checked })} /><span /></label>
              </div>
              <div className="tag-list">{group.tags.map((tag) => <code key={tag}>{tag}</code>)}</div>
              <div className="threshold-row">
                <label htmlFor={`threshold-${group.id}`}>触发阈值 <strong>{Math.round(setting.minimumConfidence * 100)}%</strong></label>
                <input id={`threshold-${group.id}`} type="range" min="0.05" max="0.95" step="0.05" value={setting.minimumConfidence} onChange={(event) => onEdit({ ...setting, minimumConfidence: Number(event.target.value) })} />
                <small>越低越敏感，误拦截也会更多。</small>
              </div>
              {group.id.startsWith("custom-") && (
                <CustomGroupEditor group={group as CustomElementGroup} onChange={(next) => onCustomGroupsChange(customGroups.map((item) => item.id === next.id ? next : item))} />
              )}
              <div className="rule-card-actions">
                <Button busy={savingGroupId === group.id} busyLabel="保存中…" onClick={() => onSave(setting)}>保存此组</Button>
                {group.id.startsWith("custom-") && <Button variant="danger-soft" size="small" onClick={() => void onCustomGroupsChange(customGroups.filter((item) => item.id !== group.id))}>删除</Button>}
              </div>
            </article>
          );
        })}
      </section>

      <section className="custom-rule-builder">
        <div><p className="eyebrow">CUSTOM GROUP</p><h2>新增自定义元素组</h2></div>
        <input value={customName} maxLength={80} placeholder="元素组名称" onChange={(event) => setCustomName(event.target.value)} />
        <input value={customTags} placeholder="WD 标签，使用逗号或空格分隔" onChange={(event) => setCustomTags(event.target.value)} />
        <input value={customAliases} placeholder="可选别名" onChange={(event) => setCustomAliases(event.target.value)} />
        <select value={customAction} onChange={(event) => setCustomAction(event.target.value as "blur" | "hide")}><option value="hide">隐藏</option><option value="blur">模糊</option></select>
        <Button variant="primary" disabled={!customName.trim() || !customTags.trim()} onClick={() => void createCustomGroup()}>添加元素组</Button>
      </section>

      <SectionHeading eyebrow="RULE SANDBOX" title="规则测试与模型能力" description="只分析选中的单张图片，不入库、不改变作品信任状态。" />
      <section className="model-capability-card">
        <div>
          <strong>{status?.visionEngine ?? "检测中"}</strong>
          <small>{status?.visionReady
            ? `${status.visionProvider} · ${status.modelBacked ? "模型已就绪" : "开发探针已就绪"}`
            : status?.visionState === "starting"
              ? "正在装载模型"
              : `模型未就绪${status?.visionError ? ` · ${status.visionError}` : ""}`}</small>
        </div>
        <Button disabled={!status?.visionReady} busy={sandboxBusy} busyLabel="分析中…" onClick={() => void testImage()}>选择测试图片</Button>
        {sandboxResult && (
          <div className="sandbox-result">
            <strong>{sandboxResult.fileName} · {sandboxResult.decision.action}</strong>
            <small>{sandboxResult.assessment.engine} {sandboxResult.assessment.engineVersion} · {sandboxResult.assessment.elapsedMs}ms</small>
            <p>{sandboxResult.decision.reasons.length ? sandboxResult.decision.reasons.map((reason) => `${reason.label} ${Math.round(reason.confidence * 100)}%`).join(" · ") : "未命中当前元素规则"}</p>
          </div>
        )}
      </section>
    </>
  );
}

function CustomGroupEditor({ group, onChange }: { group: CustomElementGroup; onChange: (group: CustomElementGroup) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [tags, setTags] = useState(group.tags.join(", "));
  const [aliases, setAliases] = useState(group.aliases.join(", "));
  const [action, setAction] = useState(group.action);
  if (!expanded) return <Button variant="ghost" size="small" onClick={() => setExpanded(true)}>编辑标签与动作</Button>;
  return (
    <div className="custom-group-editor">
      <input aria-label={`${group.name}标签`} value={tags} onChange={(event) => setTags(event.target.value)} />
      <input aria-label={`${group.name}别名`} value={aliases} placeholder="可选别名" onChange={(event) => setAliases(event.target.value)} />
      <select aria-label={`${group.name}动作`} value={action} onChange={(event) => setAction(event.target.value as "blur" | "hide")}><option value="hide">隐藏</option><option value="blur">模糊</option></select>
      <Button size="small" disabled={splitLabels(tags).length === 0} onClick={() => void onChange({ ...group, tags: splitLabels(tags), aliases: splitLabels(aliases), action })}>应用编辑</Button>
    </div>
  );
}

function PreferenceSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="settings-section-heading"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><span>{description}</span></div>;
}

function splitLabels(value: string): string[] {
  return [...new Set(value.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean))];
}
