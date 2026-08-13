import {
  ELEMENT_BLACKLIST_GROUPS,
  type AppearancePreferences,
  type ElementFilterSetting
} from "@sanctuary/domain";

export function SettingsView({
  settings,
  appearance,
  savingGroupId,
  error,
  onEdit,
  onSave,
  onAppearanceChange
}: {
  settings: ElementFilterSetting[];
  appearance: AppearancePreferences;
  savingGroupId: string;
  error: string;
  onEdit: (setting: ElementFilterSetting) => void;
  onSave: (setting: ElementFilterSetting) => void;
  onAppearanceChange: (preferences: AppearancePreferences) => Promise<void>;
}) {
  return (
    <>
      <header className="topbar rules-heading">
        <div>
          <p className="eyebrow">PREFERENCES</p>
          <h1>设置</h1>
          <p className="page-description">
            调整画廊呈现、性能成本和探索空间的元素拦截。
          </p>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="appearance-settings-card">
        <header>
          <div>
            <p className="eyebrow">APPEARANCE</p>
            <h2>外观与性能</h2>
          </div>
          <span>布局与功能位置不会随档位改变</span>
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
            <span>
              <strong>作品环境展示</strong>
              <small>使用最近作品修饰画廊顶部；省电档始终关闭。</small>
            </span>
            <input
              type="checkbox"
              checked={appearance.ambientArtwork}
              onChange={(event) => void onAppearanceChange({
                ...appearance,
                ambientArtwork: event.target.checked
              })}
            />
          </label>
          <label>
            <span>
              <strong>减少动态效果</strong>
              <small>关闭位移、缩放和非必要动画。</small>
            </span>
            <input
              type="checkbox"
              checked={appearance.reducedMotion}
              onChange={(event) => void onAppearanceChange({
                ...appearance,
                reducedMotion: event.target.checked
              })}
            />
          </label>
        </div>
      </section>

      <div className="settings-section-heading">
        <p className="eyebrow">ELEMENT BLACKLIST</p>
        <h2>元素拦截规则</h2>
        <span>只控制不受欢迎的画面元素；R18、裸体和露骨程度不参与拦截。</span>
      </div>

      <section className="rules-grid">
        {ELEMENT_BLACKLIST_GROUPS.map((group) => {
          const setting = settings.find((item) => item.groupId === group.id);
          if (!setting) return null;
          const saving = savingGroupId === group.id;
          return (
            <article className={`rule-card ${setting.enabled ? "enabled" : "disabled"}`} key={group.id}>
              <div className="rule-card-header">
                <div>
                  <span className="rule-state">{setting.enabled ? "正在拦截" : "已停用"}</span>
                  <h2>{group.name}</h2>
                  <p>{group.description}</p>
                </div>
                <label className="switch" title={`切换${group.name}`}>
                  <input
                    type="checkbox"
                    checked={setting.enabled}
                    onChange={(event) => onEdit({ ...setting, enabled: event.target.checked })}
                  />
                  <span />
                </label>
              </div>

              <div className="tag-list">
                {group.tags.map((tag) => <code key={tag}>{tag}</code>)}
              </div>

              <div className="threshold-row">
                <label htmlFor={`threshold-${group.id}`}>
                  触发阈值 <strong>{Math.round(setting.minimumConfidence * 100)}%</strong>
                </label>
                <input
                  id={`threshold-${group.id}`}
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.05"
                  value={setting.minimumConfidence}
                  onChange={(event) => onEdit({
                    ...setting,
                    minimumConfidence: Number(event.target.value)
                  })}
                />
                <small>越低越敏感，误拦截也会更多。</small>
              </div>

              <button
                className="secondary save-rule"
                disabled={saving}
                onClick={() => onSave(setting)}
              >
                {saving ? "保存中…" : "保存此组"}
              </button>
            </article>
          );
        })}
      </section>
    </>
  );
}
