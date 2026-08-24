import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomElementGroup, InspectArtworkPage, VisionAssessment } from "@sanctuary/domain";
import type { ApplicationStatus } from "../../preload/index";
import { Button } from "./Button";
import { AppNotice } from "./AppNotice";
import { PromptWorkbenchPanel } from "./PromptWorkbenchPanel";

export interface ElementInspectorTarget {
  workId?: string;
  artworkId?: string;
  url?: string;
  title?: string;
  pageIndex?: number;
}

export function ElementInspectorDrawer({
  target,
  onClose,
  onBlacklistUpdated,
  onGenerated
}: {
  target: ElementInspectorTarget | null;
  onClose: () => void;
  onBlacklistUpdated?: (groups: CustomElementGroup[]) => void;
  onGenerated?: () => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(true);
  const [assessment, setAssessment] = useState<VisionAssessment | null>(null);
  const [pages, setPages] = useState<InspectArtworkPage[]>([]);
  const [pageCount, setPageCount] = useState<number>(1);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [currentThumbUrl, setCurrentThumbUrl] = useState<string>("");
  const [error, setError] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [action, setAction] = useState<"hide" | "blur">("hide");
  const [threshold, setThreshold] = useState<number>(0.4);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [minConfidenceFilter, setMinConfidenceFilter] = useState<number>(0.2);
  const [runtimeStatus, setRuntimeStatus] = useState<ApplicationStatus | null>(null);
  const [activeSection, setActiveSection] = useState<"features" | "prompt" | "filter">("features");

  const loadAnalysis = useCallback((overridePageIndex?: number) => {
    if (!target) return;
    setLoading(true);
    setAssessment(null);
    setError("");
    setNotice("");
    setSelectedTags([]);

    const pageIdx = overridePageIndex !== undefined ? overridePageIndex : target.pageIndex;
    const inspectParams: { workId?: string; artworkId?: string; url?: string; pageIndex?: number } = {};
    if (target.workId) inspectParams.workId = target.workId;
    if (target.artworkId) inspectParams.artworkId = target.artworkId;
    if (target.url) inspectParams.url = target.url;
    if (pageIdx !== undefined) inspectParams.pageIndex = pageIdx;

    window.sanctuary
      .inspectArtwork(inspectParams)
      .then((res) => {
        if (!res || !res.assessment) {
          setError("没有收到可显示的标签结果。请查看上方模型状态后重试。");
          setAssessment(null);
        } else {
          setAssessment(res.assessment);
          setPages(res.pages || []);
          setPageCount(res.pageCount || 1);
          const activeIdx = res.activePageIndex ?? 0;
          setActivePageIndex(activeIdx);
          const thumb = res.pages?.[activeIdx]?.thumbUrl || res.pages?.[activeIdx]?.regularUrl || res.url || target.url || "";
          setCurrentThumbUrl(thumb);
        }
      })
      .catch((err) => {
        const rawMessage = err instanceof Error ? err.message : "分析失败";
        setError(rawMessage.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ""));
        setAssessment(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [target]);

  useEffect(() => {
    let active = true;
    void window.sanctuary.status()
      .then((nextStatus) => {
        if (active) setRuntimeStatus(nextStatus);
      })
      .catch(() => undefined);
    const unsubscribe = window.sanctuary.onAppStatus((nextStatus) => {
      if (active) setRuntimeStatus(nextStatus);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const targetKey = target ? `${target.workId ?? ""}:${target.artworkId ?? ""}:${target.url ?? ""}:${target.pageIndex ?? ""}` : "";

  useEffect(() => {
    if (!targetKey) {
      setAssessment(null);
      setPages([]);
      setPageCount(1);
      setActivePageIndex(0);
      setCurrentThumbUrl("");
      setError("");
      setSelectedTags([]);
      setNotice("");
      setActiveSection("features");
      return;
    }
    setActiveSection("features");
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

  const handleSelectPage = (pageIdx: number) => {
    if (pageIdx === activePageIndex && assessment) return;
    setActivePageIndex(pageIdx);
    const selectedPage = pages[pageIdx];
    if (selectedPage) {
      setCurrentThumbUrl(selectedPage.thumbUrl || selectedPage.regularUrl);
    }
    loadAnalysis(pageIdx);
  };

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

  const renderTagBrowser = (selectable: boolean) => (
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
          高把握特征 ({countAt40})
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
          placeholder="搜索标签，例如 cat_ears、swimsuit…"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
        />
        <span className="inspector-count-chip">
          {sortedTags.length} / {rawEntries.length}
        </span>
      </div>

      <div className={`inspector-tags-grid ${selectable ? "is-selectable" : "is-readable"}`}>
        {sortedTags.length === 0 ? (
          <div className="inspector-no-tags">
            <span>当前筛选条件或搜索没有匹配标签</span>
          </div>
        ) : (
          sortedTags.map(([tag, confidence]) => {
            const isSelected = selectedTags.includes(tag);
            const pct = Math.round(confidence * 100);
            const isHigh = confidence >= 0.7;
            const isMedium = confidence >= 0.4 && confidence < 0.7;
            const className = `inspector-tag-pill ${isSelected ? "selected" : ""} ${isHigh ? "high-conf" : isMedium ? "med-conf" : ""} ${selectable ? "" : "is-static"}`;
            const content = (
              <>
                <span className="inspector-tag-name">{tag}</span>
                <span className="inspector-tag-conf">{pct}%</span>
                {selectable && <span className="inspector-tag-check">{isSelected ? "✓" : "+"}</span>}
              </>
            );
            return selectable ? (
              <button
                key={tag}
                type="button"
                className={className}
                onClick={() => toggleTag(tag)}
                title={`识别把握 ${pct}% · 点击选择为探索拦截规则`}
              >
                {content}
              </button>
            ) : (
              <span key={tag} className={className} title={`WD Tagger 识别把握 ${pct}%`}>
                {content}
              </span>
            );
          })
        )}
      </div>
    </>
  );

  if (!target) return null;

  return (
    <aside className="element-inspector-overlay" role="dialog" aria-modal="true" aria-label="AI 元素透视与拦截">
      <div className="element-inspector-drawer">
        {loading && <div className="inspector-scan-bar" />}
        <header className="inspector-header">
          <div className="inspector-target-info">
            {(currentThumbUrl || target.url) && (
              <img
                src={currentThumbUrl || target.url}
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
              title="重新解析当前单页特征"
              onClick={() => loadAnalysis(activePageIndex)}
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

        <div className={`inspector-runtime-status ${runtimeStatus?.visionReady ? "ready" : runtimeStatus?.visionState ?? "starting"}`}>
          <span className="inspector-runtime-dot" aria-hidden="true" />
          <div>
            <strong>
              {runtimeStatus?.visionReady
                ? "本地 WD Tagger 已就绪"
                : !runtimeStatus || runtimeStatus.visionState === "starting"
                  ? "正在确认本地模型状态"
                  : "本地模型暂未就绪"}
            </strong>
            <small>
              {runtimeStatus?.visionReady
                ? `${runtimeStatus.visionProvider} · 图片只在本机分析`
                : runtimeStatus?.visionError || "正在读取视觉引擎状态"}
            </small>
          </div>
        </div>

        {notice && <AppNotice tone="success" onDismiss={() => setNotice("")}>{notice}</AppNotice>}
        {error && <AppNotice tone="error">{error}</AppNotice>}

        {pageCount > 1 && pages.length > 1 && (
          <div className="inspector-multi-page-section">
            <div className="inspector-focus-notice">
              <span className="inspector-focus-icon">💡</span>
              <span className="inspector-focus-text">
                已自动匹配视口焦点单页 <strong>(P{activePageIndex + 1})</strong> · 多图作品可在下方自由切换单页
              </span>
            </div>
            <div className="inspector-page-picker-row" role="tablist" aria-label="多图分页选择器">
              {pages.map((p) => (
                <button
                  key={p.pageIndex}
                  type="button"
                  role="tab"
                  aria-selected={activePageIndex === p.pageIndex}
                  className={`inspector-page-pill ${activePageIndex === p.pageIndex ? "active" : ""}`}
                  onClick={() => handleSelectPage(p.pageIndex)}
                  title={`查看第 ${p.pageIndex + 1} 页的 AI 视觉特征`}
                >
                  {p.pageIndex === 0 ? `P1 (主图)` : `P${p.pageIndex + 1}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="inspector-loading">
            <div className="inspector-radar-container">
              <div className="inspector-radar-sweep" />
              <div className="inspector-radar-pulse" />
              <span className="inspector-radar-icon">⚡</span>
            </div>
            <div className="inspector-loading-text">
              <strong>正在深度解析 P{activePageIndex + 1} 单页特征...</strong>
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
            <Button variant="primary" onClick={() => loadAnalysis(activePageIndex)}>
              🔄 重新尝试解析
            </Button>
          </div>
        ) : assessment ? (
          <div className="inspector-workspace">
            <nav className="inspector-section-tabs" aria-label="元素透视功能切换">
              <button type="button" className={activeSection === "features" ? "active" : ""} onClick={() => setActiveSection("features")}>
                <span>看懂画面</span><small>{rawEntries.length} 个标签</small>
              </button>
              <button type="button" className={activeSection === "prompt" ? "active" : ""} onClick={() => setActiveSection("prompt")}>
                <span>整理提示词</span><small>本图临时选择</small>
              </button>
              <button type="button" className={activeSection === "filter" ? "active" : ""} onClick={() => setActiveSection("filter")}>
                <span>设置探索拦截</span><small>{selectedTags.length > 0 ? `已选 ${selectedTags.length}` : "可选"}</small>
              </button>
            </nav>

            {activeSection === "features" && (
              <section className="inspector-section-panel" aria-label="画面识别结果">
                <div className="inspector-section-intro">
                  <div><strong>这张图片里识别到了什么</strong><span>按识别把握从高到低排列，可以搜索或切换显示范围。</span></div>
                  <p><strong>%</strong> 表示模型认为元素存在的把握，不是生成提示词权重。</p>
                </div>
                {renderTagBrowser(false)}
              </section>
            )}

            {activeSection === "prompt" && (
              <section className="inspector-section-panel prompt-section-panel" aria-label="本图生成提示词">
                <PromptWorkbenchPanel
                  assessment={assessment}
                  workId={target.workId}
                  pageIndex={activePageIndex}
                  onGenerated={onGenerated}
                />
              </section>
            )}

            {activeSection === "filter" && (
              <section className="inspector-section-panel" aria-label="探索拦截规则">
                <div className="inspector-section-intro">
                  <div><strong>以后在探索里少看到哪些元素</strong><span>先选择元素，再决定隐藏方式和触发把握。</span></div>
                  <p>只影响远程探索；已经下载到画廊的图片始终正常显示。</p>
                </div>
                {renderTagBrowser(true)}
                <div className="inspector-action-footer">
                  <div className="inspector-action-header">
                    <strong>自定义探索拦截</strong>
                    <span>已选择 {selectedTags.length} 个标签</span>
                  </div>
                  <div className="inspector-rule-inputs">
                    <div className="inspector-input-group">
                      <label>命中后怎么显示</label>
                      <select
                        className="inspector-select"
                        value={action}
                        onChange={(e) => setAction(e.target.value as "hide" | "blur")}
                      >
                        <option value="hide">遮住整张图片</option>
                        <option value="blur">保持模糊，可手动查看</option>
                      </select>
                    </div>
                    <div className="inspector-input-group">
                      <label>至少达到多少识别把握：{Math.round(threshold * 100)}%</label>
                      <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.05"
                        value={threshold}
                        className="inspector-slider"
                        onChange={(e) => setThreshold(parseFloat(e.target.value))}
                      />
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    disabled={selectedTags.length === 0 || saving}
                    onClick={handleAddBlacklist}
                    className="inspector-submit-btn"
                  >
                    {saving ? "正在保存…" : selectedTags.length === 0 ? "请先选择要拦截的元素" : `保存 ${selectedTags.length} 个探索拦截规则`}
                  </Button>
                </div>
              </section>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
