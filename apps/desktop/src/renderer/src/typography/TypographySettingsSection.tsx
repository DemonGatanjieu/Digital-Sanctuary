import React, { useState, useEffect, useMemo } from "react";
import {
  DEFAULT_TYPOGRAPHY_PREFERENCES_V1,
  type TypographyFontDescriptor,
  type TypographyFontRef,
  type TypographyPreferencesV1,
  type TypographySlot
} from "@sanctuary/domain";
import { useTypography } from "./TypographyProvider.js";

const SLOT_DEFINITIONS: Array<{
  id: TypographySlot;
  name: string;
  icon: string;
  description: string;
}> = [
  {
    id: "body",
    name: "全局界面正文字体",
    icon: "🔤",
    description: "应用于侧栏导航、作品卡片、筛选控件、说明文案及标准交互按钮。"
  },
  {
    id: "display",
    name: "艺术展示与标题字体",
    icon: "✨",
    description: "应用于画廊主标题、Hero 氛围横幅、星盘罗盘及页面级醒目大字。"
  },
  {
    id: "editorial",
    name: "画册与典藏题记字体",
    icon: "📖",
    description: "应用于精装相册卷首语、引言诗句、篇目索引及人文艺术排版。"
  },
  {
    id: "mono",
    name: "等宽数据与终端字体",
    icon: "💻",
    description: "应用于作品 ID、图片分辨率、任务执行时间戳与调试监控信息。"
  }
];

export const TypographySettingsSection: React.FC = () => {
  const { preferences, fonts, loading, updatePreferences, importFont, deleteFont } = useTypography();

  const [draft, setDraft] = useState<TypographyPreferencesV1>(preferences);
  const [systemFonts, setSystemFonts] = useState<Array<{ family: string; fullName: string; postscriptName?: string }>>([]);
  const [readingSystemFonts, setReadingSystemFonts] = useState(false);
  const [systemFontsRead, setSystemFontsRead] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    setDraft(preferences);
  }, [preferences]);

  const isDirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(preferences);
  }, [draft, preferences]);

  const handleSlotChange = (slot: TypographySlot, value: string) => {
    const [source, ...rest] = value.split("::");
    const payload = rest.join("::");

    let newRef: TypographyFontRef;
    if (source === "preset") {
      newRef = { source: "preset", id: payload };
    } else if (source === "custom") {
      newRef = { source: "custom", id: payload };
    } else if (source === "system") {
      const parts = payload.split("||");
      const family = parts[0] || payload;
      const postscriptName = parts[1] || undefined;
      newRef = { source: "system", family, ...(postscriptName ? { postscriptName } : {}) };
    } else {
      newRef = DEFAULT_TYPOGRAPHY_PREFERENCES_V1.slots[slot];
    }

    setDraft((prev) => ({
      ...prev,
      slots: {
        ...prev.slots,
        [slot]: newRef
      }
    }));
  };

  const handleRevertSlot = (slot: TypographySlot) => {
    setDraft((prev) => ({
      ...prev,
      slots: {
        ...prev.slots,
        [slot]: DEFAULT_TYPOGRAPHY_PREFERENCES_V1.slots[slot]
      }
    }));
  };

  const handleSave = async () => {
    await updatePreferences(draft);
    setActionMessage({ tone: "success", text: "排版与个性化字体设置已保存并生效" });
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handleCancel = () => {
    setDraft(preferences);
    setActionMessage({ tone: "info", text: "已放弃未保存的排版修改" });
    setTimeout(() => setActionMessage(null), 2500);
  };

  const handleRevertAll = () => {
    setDraft(DEFAULT_TYPOGRAPHY_PREFERENCES_V1);
  };

  const handleImportFont = async () => {
    const result = await importFont();
    if (result) {
      setActionMessage({ tone: "success", text: `成功导入字体「${result.fullName}」` });
    }
  };

  const handleReadSystemFonts = async () => {
    const win = window as unknown as {
      queryLocalFonts?: () => Promise<Array<{ family: string; fullName?: string; postscriptName?: string }>>;
    };

    if (typeof win.queryLocalFonts !== "function") {
      setActionMessage({ tone: "error", text: "当前环境不支持 Local Font Access API" });
      return;
    }

    setReadingSystemFonts(true);
    try {
      const rawFonts = await win.queryLocalFonts();
      // Deduplicate by family name and sort
      const familyMap = new Map<string, { family: string; fullName: string; postscriptName?: string }>();
      for (const f of rawFonts) {
        if (!familyMap.has(f.family)) {
          const entry: { family: string; fullName: string; postscriptName?: string } = {
            family: f.family,
            fullName: f.fullName || f.family
          };
          if (f.postscriptName) {
            entry.postscriptName = f.postscriptName;
          }
          familyMap.set(f.family, entry);
        }
      }
      const sorted = Array.from(familyMap.values()).sort((a, b) => a.family.localeCompare(b.family));
      setSystemFonts(sorted);
      setSystemFontsRead(true);
      setActionMessage({ tone: "success", text: `成功读取到 ${sorted.length} 个系统已安装字族` });
    } catch (err) {
      setActionMessage({ tone: "error", text: `读取系统字体失败: ${(err as Error).message}` });
    } finally {
      setReadingSystemFonts(false);
    }
  };

  const handleDeleteCustomFont = async (fontId: string, fontName: string) => {
    if (confirm(`确定要从应用字体沙箱中移除「${fontName}」吗？若有槽位正在使用，将自动恢复为默认字体。`)) {
      const ok = await deleteFont(fontId);
      if (ok) {
        setActionMessage({ tone: "info", text: `已移除自定义字体「${fontName}」` });
      }
    }
  };

  if (loading) {
    return (
      <section className="settings-section typography-settings-section" aria-label="排版与个性化字体">
        <div className="section-header">
          <p className="eyebrow">TYPOGRAPHY & FONTS</p>
          <h2>排版与个性化字体</h2>
          <p className="section-description">正在加载排版设置...</p>
        </div>
      </section>
    );
  }

  const customFonts = fonts.filter((f) => f.source === "custom");
  const presetFonts = fonts.filter((f) => f.source === "preset");

  return (
    <section className="settings-section typography-settings-section" aria-label="排版与个性化字体">
      <div className="section-header">
        <p className="eyebrow">TYPOGRAPHY & FONTS</p>
        <h2>排版与个性化字体</h2>
        <p className="section-description">
          为正文、标题、画册题记与等宽数据独立选用高品质字族。支持导入本地 TTF/OTF 字体文件及读取 Windows 系统字体。
        </p>
      </div>

      {actionMessage && (
        <div style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, background: "var(--ds-bg-card)", border: "1px solid var(--ds-border-light)", fontSize: 13 }}>
          {actionMessage.tone === "success" ? "✓ " : actionMessage.tone === "error" ? "✕ " : "ℹ "}
          {actionMessage.text}
        </div>
      )}

      {/* 4 Typography Slots Cards */}
      <div className="typography-slots-grid">
        {SLOT_DEFINITIONS.map((slotDef) => {
          const currentRef: TypographyFontRef = draft.slots[slotDef.id] ?? DEFAULT_TYPOGRAPHY_PREFERENCES_V1.slots[slotDef.id];
          const isDefault = JSON.stringify(currentRef) === JSON.stringify(DEFAULT_TYPOGRAPHY_PREFERENCES_V1.slots[slotDef.id]);

          let selectValue = "preset::preset.system-ui";
          if (currentRef.source === "preset") {
            selectValue = `preset::${currentRef.id}`;
          } else if (currentRef.source === "custom") {
            selectValue = `custom::${currentRef.id}`;
          } else if (currentRef.source === "system") {
            selectValue = `system::${currentRef.family}${currentRef.postscriptName ? `||${currentRef.postscriptName}` : ""}`;
          }

          return (
            <div key={slotDef.id} className="typography-slot-card">
              <div className="slot-header">
                <div className="slot-title-group">
                  <span className="slot-icon">{slotDef.icon}</span>
                  <span className="slot-name">{slotDef.name}</span>
                </div>
                <span className={`slot-badge source-${currentRef.source}`}>
                  {currentRef.source === "preset" ? "内置预设" : currentRef.source === "custom" ? "沙箱导入" : "系统字体"}
                </span>
              </div>

              <p className="slot-desc">{slotDef.description}</p>

              <div className="slot-select-row">
                <select
                  className="slot-select"
                  value={selectValue}
                  aria-label={slotDef.name}
                  onChange={(e) => handleSlotChange(slotDef.id, e.target.value)}
                >
                  <optgroup label="内置精选预设">
                    {presetFonts.map((pf) => (
                      <option key={pf.id} value={`preset::${pf.id}`}>
                        {pf.fullName}
                      </option>
                    ))}
                  </optgroup>

                  {customFonts.length > 0 && (
                    <optgroup label="已导入自定义字体 (沙箱)">
                      {customFonts.map((cf) => (
                        <option key={cf.id} value={`custom::${cf.id}`}>
                          {cf.fullName} ({cf.status === "available" ? "可用" : "缺失"})
                        </option>
                      ))}
                    </optgroup>
                  )}

                  {systemFonts.length > 0 && (
                    <optgroup label="Windows 系统已安装字体">
                      {systemFonts.map((sf) => (
                        <option key={sf.family} value={`system::${sf.family}${sf.postscriptName ? `||${sf.postscriptName}` : ""}`}>
                          {sf.fullName}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                <button
                  type="button"
                  className="slot-revert-btn"
                  title="恢复此槽位默认字体"
                  disabled={isDefault}
                  onClick={() => handleRevertSlot(slotDef.id)}
                >
                  ↺ 默认
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions Toolbar */}
      <div className="typography-actions-toolbar">
        <div className="typography-btn-group">
          <button
            type="button"
            className="typography-action-btn btn-primary"
            onClick={handleImportFont}
            title="选择本地 .ttf 或 .otf 字体文件复制至应用沙箱管理"
          >
            + 导入本地字体文件 (.ttf / .otf)
          </button>

          <button
            type="button"
            className="typography-action-btn btn-secondary"
            onClick={handleReadSystemFonts}
            disabled={readingSystemFonts}
            title="显式授权读取 Windows 已安装字体列表"
          >
            {readingSystemFonts ? "正在读取..." : systemFontsRead ? `已读取 ${systemFonts.length} 个系统字体` : "📖 读取 Windows 系统字体"}
          </button>
        </div>

        <div className="typography-btn-group">
          <button
            type="button"
            className="typography-action-btn btn-secondary"
            onClick={handleRevertAll}
            title="将全部四个槽位恢复为默认字族"
          >
            ↺ 恢复全部默认
          </button>
        </div>
      </div>

      {/* Custom Fonts Management List (if any) */}
      {customFonts.length > 0 && (
        <div style={{ marginTop: 16, background: "var(--ds-bg-card)", border: "1px solid var(--ds-border-light)", borderRadius: 12, padding: "14px 18px" }}>
          <h4 style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ds-text-heading)" }}>已安装自定义字体管理 ({customFonts.length})</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {customFonts.map((cf) => (
              <div
                key={cf.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  background: "var(--ds-bg-card-subtle)",
                  border: "1px solid var(--ds-border-light)",
                  borderRadius: 20,
                  fontSize: 12
                }}
              >
                <span>{cf.fullName}</span>
                <button
                  type="button"
                  style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: "0 4px", fontSize: 13 }}
                  title="从沙箱删除该字体"
                  onClick={() => handleDeleteCustomFont(cf.id, cf.fullName)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Multi-Lingual Realtime Preview Card */}
      <div className="typography-preview-box">
        <div className="preview-box-header">
          <h4>实时多语种排版预览</h4>
          <span style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>随当前草稿实时渲染</span>
        </div>

        <div className="preview-sample-grid">
          <div className="preview-sample-card">
            <div className="preview-label">UI 正文预览 (Body Slot)</div>
            <div className="preview-text-body">
              纯净领域为你守护二次元的数字底护所。精选东方与现代画作收藏，极速检索，优雅分类。
            </div>
          </div>

          <div className="preview-sample-card">
            <div className="preview-label">艺术标题预览 (Display Slot)</div>
            <div className="preview-text-display">
              博麗霊夢 · 星河之下 · 2026
            </div>
          </div>

          <div className="preview-sample-card">
            <div className="preview-label">画册题记预览 (Editorial Slot)</div>
            <div className="preview-text-editorial">
              “涵盖博丽神社与红魔馆经典场景人文画集，记录时光里的每一抹绚烂光影。”
            </div>
          </div>

          <div className="preview-sample-card">
            <div className="preview-label">等宽数据预览 (Mono Slot)</div>
            <div className="preview-text-mono">
              ILLUST #109284712 · 3840×2160 · 4.8MB · SHA256: 8f9a2b0e
            </div>
          </div>
        </div>
      </div>

      {/* Floating Save Action Bar if isDirty */}
      {isDirty && (
        <div className="typography-save-bar" role="alert">
          <p>⚠️ 您有未保存的排版与字体修改</p>
          <div className="typography-btn-group">
            <button type="button" className="typography-action-btn btn-secondary" onClick={handleCancel}>
              取消修改
            </button>
            <button type="button" className="typography-action-btn btn-primary" onClick={handleSave}>
              ✓ 保存并应用排版
            </button>
          </div>
        </div>
      )}

      {/* Privacy & Backup Note */}
      <div style={{ marginTop: 14, fontSize: 11.5, color: "var(--ds-text-muted)", lineHeight: 1.6 }}>
        💡 <strong>隐私与数据说明</strong>：读取系统字体仅在本地提取字体名称用于渲染呈现，绝不上传任何字体数据。自定义导入的字体保存在本地应用沙箱中；数据库备份仅包含排版偏好配置，不包含字体二进制文件。
      </div>
    </section>
  );
};
