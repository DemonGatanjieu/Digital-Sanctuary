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
    setAssessment(null);
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

  const targetKey = target ? `${target.workId ?? ""}:${target.artworkId ?? ""}:${target.url ?? ""}` : "";

  useEffect(() => {
    if (!targetKey) {
      setAssessment(null);
      setError("");
      setSelectedTags([]);
      setNotice("");
      return;
    }
    loadAnalysis();
  }, [loadAnalysis, targetKey]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const displayTargetName = useMemo(() => {
    if (!target) return "";
    if (target.title) return target.title;
    if (target.artworkId && /^\d+$/.test(target.artworkId)) {
      return `Pixiv 作品 · ${target.artworkId}`;
    }
    return "当前探索画作";
  }, [target]);

  const [minConfidenceFilter, setMinConfidenceFilter] = useState<number>(0.2);

  const rawEntries = useMemo(() => {
    if (!assessment?.labels) return [];
    const entries = Object.entries(assessment.labels);
    entries.sort((a, b) => b[1] - a[1]);
    return entries;
  }, [assessment?.labels]);

  const countAt20 = useMemo(() => rawEntries.filter(([, conf]) => conf >= 0.2).length, [rawEntries]);
  const countAt40 = useMemo(() => rawEntries.filter(([, conf]) => conf >= 0.4).length, [rawEntries]);

  const sortedTags = useMemo(() => {
    const filteredByConf = rawEntries.filter(([, conf]) => conf >= minConfidenceFilter);
    if (!searchFilter.trim()) return filteredByConf;
    const q = searchFilter.trim().toLowerCase();
    return filteredByConf.filter(([tag]) => tag.toLowerCase().includes(q));
  }, [rawEntries, minConfidenceFilter, searchFilter]);

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
        {loading && <div className="inspector-scan-bar" />}
        <header className="inspector-header">
          <div className="inspector-target-info">
            {target.url && (
              <img
                src={target.url}
                alt="画作缩略图"
                className="inspector-target-thumb"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = "none";
                }}
              />
            )}
            <div className="inspector-target-text">
              <p className="eyebrow">AI 画面视觉特征透视</p>
              <h3>AI 画面特征拆解</h3>
              <span className="inspector-target-name" title={displayTargetName}>
                {displayTargetName}
              </span>
            </div>
          </div>
          <div className="inspector-header-actions">
            <button
              type="button"
              className="inspector-refresh-btn"
              title="重新解析当前作品特征"
              onClick={loadAnalysis}
              disabled={loading}
            >
              <span className={`inspector-refresh-icon ${loading ? "spinning" : ""}`}>🔄</span>
              <span>{loading ? "解析中" : "重新解析"}</span>
            </button>
            <button type="button" className="inspector-close-btn" aria-label="关闭透视抽屉 (Esc)" title="关闭 (Esc)" onClick={onClose}>
              ✕
            </button>
          </div>
        </header>

        {notice && <AppNotice tone="success" onDismiss={() => setNotice("")}>{notice}</AppNotice>}
        {error && <AppNotice tone="error">{error}</AppNotice>}

        {loading ? (
          <div className="inspector-loading">
            <div className="inspector-radar-container">
              <div className="inspector-radar-sweep" />
              <div className="inspector-radar-pulse" />
              <span className="inspector-radar-icon">⚡</span>
            </div>
            <div className="inspector-loading-text">
              <strong>正在深度解析新画作特征...</strong>
              <span>WD Tagger 正在逐层提取当前单张画作的视觉特征向量</span>
            </div>
            <div className="inspector-skeleton-grid">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="inspector-skeleton-chip"
                  style={{ width: `${60 + (i % 5) * 22}px`, animationDelay: `${i * 0.08}s` }}
                />
              ))}
            </div>
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
            <div className="inspector-conf-filter-row">
              <button
                type="button"
                className={`inspector-conf-tab ${minConfidenceFilter === 0.2 ? "active" : ""}`}
                onClick={() => setMinConfidenceFilter(0.2)}
              >
                主要特征 ({countAt20})
              </button>
              <button
                type="button"
                className={`inspector-conf-tab ${minConfidenceFilter === 0.4 ? "active" : ""}`}
                onClick={() => setMinConfidenceFilter(0.4)}
              >
                高确信特征 ({countAt40})
              </button>
              <button
                type="button"
                className={`inspector-conf-tab ${minConfidenceFilter === 0.05 ? "active" : ""}`}
                onClick={() => setMinConfidenceFilter(0.05)}
              >
                全部特征 ({rawEntries.length})
              </button>
            </div>

            <div className="inspector-controls-bar">
              <input
                type="search"
                className="inspector-search-input"
                placeholder="搜索标签 (例如 cat_ears, 3d, swimsuit)..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
              <span className="inspector-status-badge">
                ✨ 显示 {sortedTags.length} 个标签
              </span>
            </div>

            <div className="inspector-tag-grid">
              {sortedTags.length === 0 ? (
                <div className="inspector-empty">没有匹配的标签</div>
              ) : (
                sortedTags.map(([tag, conf], idx) => {
                  const isChecked = selectedTags.includes(tag);
                  const pct = Math.round(conf * 100);
                  return (
                    <button
                      key={tag}
                      type="button"
                      style={{ "--chip-idx": idx } as React.CSSProperties}
                      className={`inspector-tag-chip tag-chip-enter ${isChecked ? "selected" : ""}`}
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
