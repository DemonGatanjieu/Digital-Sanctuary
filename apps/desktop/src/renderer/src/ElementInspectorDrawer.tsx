import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomElementGroup, VisionAssessment } from "@sanctuary/domain";
import { Button } from "./Button";
import { AppNotice } from "./AppNotice";

export interface ElementInspectorTarget {
  workId?: string;
  artworkId?: string;
  url?: string;
  title?: string;
}

export function ElementInspectorDrawer({
  target,
  onClose,
  onBlacklistUpdated
}: {
  target: ElementInspectorTarget | null;
  onClose: () => void;
  onBlacklistUpdated?: (groups: CustomElementGroup[]) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [assessment, setAssessment] = useState<VisionAssessment | null>(null);
  const [error, setError] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [action, setAction] = useState<"hide" | "blur">("hide");
  const [threshold, setThreshold] = useState<number>(0.4);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const loadAnalysis = useCallback(() => {
    if (!target) return;
    setLoading(true);
    setError("");
    setNotice("");
    setSelectedTags([]);

    const inspectParams: { workId?: string; artworkId?: string; url?: string } = {};
    if (target.workId) inspectParams.workId = target.workId;
    if (target.artworkId) inspectParams.artworkId = target.artworkId;
    if (target.url) inspectParams.url = target.url;

    window.sanctuary
      .inspectArtwork(inspectParams)
      .then((res) => {
        if (!res) {
          setError("未能获取该画作的视觉标签分析。可能该作品为多图/动图、需要会员/登录权限，或网络请求超时。");
          setAssessment(null);
        } else {
          setAssessment(res);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "分析失败");
        setAssessment(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [target]);

  useEffect(() => {
    if (!target) {
      setAssessment(null);
      setError("");
      setSelectedTags([]);
      setNotice("");
      return;
    }
    loadAnalysis();
  }, [loadAnalysis, target]);

  const sortedTags = useMemo(() => {
    if (!assessment?.labels) return [];
    const entries = Object.entries(assessment.labels);
    entries.sort((a, b) => b[1] - a[1]);
    if (!searchFilter.trim()) return entries;
    const q = searchFilter.trim().toLowerCase();
    return entries.filter(([tag]) => tag.toLowerCase().includes(q));
  }, [assessment?.labels, searchFilter]);

  async function handleAddBlacklist() {
    if (!selectedTags.length) return;
    setSaving(true);
    setNotice("");
    try {
      let updatedGroups: CustomElementGroup[] = [];
      for (const tag of selectedTags) {
        updatedGroups = await window.sanctuary.addCustomBlacklistTag({
          tag,
          threshold,
          action,
          groupName: "用户自定义拦截"
        });
      }
      setNotice(`已将 ${selectedTags.length} 个标签加入自定义拦截规则（动作: ${action === "hide" ? "隐藏" : "模糊"}，阈值: ${Math.round(threshold * 100)}%）`);
      setSelectedTags([]);
      onBlacklistUpdated?.(updatedGroups);
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加到拦截规则失败");
    } finally {
      setSaving(false);
    }
  }

  const toggleTag = (tag: string) => {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
    );
  };

  if (!target) return null;

  return (
    <aside className="element-inspector-overlay" role="dialog" aria-modal="true" aria-label="AI 元素透视与拦截">
      <div className="element-inspector-drawer">
        <header className="inspector-header">
          <div>
            <p className="eyebrow">AI ELEMENT INSPECTOR</p>
            <h3>AI 元素透视与特征拆解</h3>
            <span className="inspector-target-name">
              {target.title || (target.artworkId ? `Pixiv 作品 · ${target.artworkId}` : "当前画作")}
            </span>
          </div>
          <button type="button" className="inspector-close-btn" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </header>

        {notice && <AppNotice tone="success" onDismiss={() => setNotice("")}>{notice}</AppNotice>}
        {error && <AppNotice tone="error">{error}</AppNotice>}

        {loading ? (
          <div className="inspector-loading">
            <div className="cinema-loading-spinner" />
            <p>正在由 WD Tagger 引擎深度解析视觉特征...</p>
          </div>
        ) : error && !assessment ? (
          <div className="inspector-empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", marginTop: "40px" }}>
            <p style={{ maxWidth: "320px", lineHeight: 1.5 }}>{error}</p>
            <Button variant="primary" onClick={loadAnalysis}>
              🔄 重新尝试解析
            </Button>
          </div>
        ) : assessment ? (
          <>
            <div className="inspector-controls-bar">
              <input
                type="search"
                className="inspector-search-input"
                placeholder="搜索标签 (例如 chibi, 3d, sketch)..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
              <span className="inspector-tag-count">共识别出 {Object.keys(assessment.labels || {}).length} 个标签</span>
            </div>

            <div className="inspector-tag-grid">
              {sortedTags.length === 0 ? (
                <div className="inspector-empty">没有匹配的标签</div>
              ) : (
                sortedTags.map(([tag, conf]) => {
                  const isChecked = selectedTags.includes(tag);
                  const pct = Math.round(conf * 100);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`inspector-tag-chip ${isChecked ? "selected" : ""}`}
                      onClick={() => toggleTag(tag)}
                    >
                      <span className="chip-check">{isChecked ? "✓" : "+"}</span>
                      <span className="chip-label">{tag.replaceAll("_", " ")}</span>
                      <span className="chip-score">{pct}%</span>
                    </button>
                  );
                })
              )}
            </div>

            <footer className="inspector-footer">
              <div className="inspector-rule-settings">
                <label>
                  <span>触发动作</span>
                  <select value={action} onChange={(e) => setAction(e.target.value as "hide" | "blur")}>
                    <option value="hide">完全遮挡 / 隐藏 (Hide)</option>
                    <option value="blur">毛玻璃模糊 (Blur)</option>
                  </select>
                </label>
                <label>
                  <span>置信度阈值 ({Math.round(threshold * 100)}%)</span>
                  <input
                    type="range"
                    min="0.1"
                    max="0.9"
                    step="0.05"
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                  />
                </label>
              </div>

              <div className="inspector-action-row">
                <Button
                  variant="primary"
                  disabled={!selectedTags.length || saving}
                  busy={saving}
                  busyLabel="正在保存规则..."
                  onClick={() => void handleAddBlacklist()}
                >
                  🚫 将所选 {selectedTags.length > 0 ? `(${selectedTags.length})` : ""} 加入拦截黑名单
                </Button>
                {selectedTags.length > 0 && (
                  <Button variant="ghost" size="small" onClick={() => setSelectedTags([])}>
                    清空选择
                  </Button>
                )}
              </div>
            </footer>
          </>
        ) : null}
      </div>
    </aside>
  );
}
