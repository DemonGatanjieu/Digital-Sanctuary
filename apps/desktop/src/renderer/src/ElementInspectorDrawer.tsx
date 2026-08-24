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
          setError("没有收到可显示的标签结果。请确认本地模型已启动后重试。");
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
      setNotice(`已将 ${selectedTags.length} 个标签加入探索拦截规则（动作: ${action === "hide" ? "遮住图片" : "保持模糊"}，触发把握: ${Math.round(threshold * 100)}%）`);
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

  const handleSelectAllVisible = () => {
    const visibleNames = sortedTags.map(([tag]) => tag);
    setSelectedTags((current) => [...new Set([...current, ...visibleNames])]);
  };

  const handleClearSelected = () => {
    setSelectedTags([]);
  };

  const renderTagBrowser = (selectable: boolean) => (
    <div className="inspector-browser-container">
      <div className="inspector-conf-filter-row" role="tablist" aria-label="特征把握筛选">
        <button
          type="button"
          role="tab"
          aria-selected={minConfidenceFilter === 0.2}
          className={`inspector-conf-tab ${minConfidenceFilter === 0.2 ? "active" : ""}`}
          onClick={() => setMinConfidenceFilter(0.2)}
        >
          主要特征 ({countAt20})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={minConfidenceFilter === 0.4}
          className={`inspector-conf-tab ${minConfidenceFilter === 0.4 ? "active" : ""}`}
          onClick={() => setMinConfidenceFilter(0.4)}
        >
          高把握特征 ({countAt40})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={minConfidenceFilter === 0.05}
          className={`inspector-conf-tab ${minConfidenceFilter === 0.05 ? "active" : ""}`}
          onClick={() => setMinConfidenceFilter(0.05)}
        >
          全部特征 ({rawEntries.length})
        </button>
      </div>

      <div className="inspector-controls-bar">
        <div className="inspector-search-wrapper">
          <span className="inspector-search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            className="inspector-search-input"
            placeholder="搜索标签，例如 cat_ears、swimsuit…"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            aria-label="搜索特征标签"
          />
          {searchFilter && (
            <button
              type="button"
              className="inspector-search-clear"
              aria-label="清空搜索"
              title="清空搜索"
              onClick={() => setSearchFilter("")}
            >
              ✕
            </button>
          )}
        </div>
        <div className="inspector-controls-meta">
          <span className="inspector-count-chip">
            {sortedTags.length} / {rawEntries.length} 项
          </span>
          {selectable && sortedTags.length > 0 && (
            <div className="inspector-select-helpers">
              <button type="button" className="inspector-helper-btn" onClick={handleSelectAllVisible} title="选中当前筛选出的全部标签">
                全选筛选
              </button>
              {selectedTags.length > 0 && (
                <button type="button" className="inspector-helper-btn" onClick={handleClearSelected} title="取消全部已选标签">
                  清空已选
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={`inspector-tags-grid ${selectable ? "is-selectable" : "is-readable"}`} role={selectable ? "group" : undefined} aria-label="特征标签列表">
        {sortedTags.length === 0 ? (
          <div className="inspector-no-tags">
            <span className="inspector-no-tags-icon">🍃</span>
            <p>{searchFilter ? `未找到与 “${searchFilter}” 匹配的标签` : "当前把握区间没有识别到标签"}</p>
            {searchFilter ? (
              <button type="button" className="inspector-reset-search-btn" onClick={() => setSearchFilter("")}>
                清空搜索条件
              </button>
            ) : minConfidenceFilter > 0.05 ? (
              <button type="button" className="inspector-reset-search-btn" onClick={() => setMinConfidenceFilter(0.05)}>
                查看全部特征 ({rawEntries.length})
              </button>
            ) : null}
          </div>
        ) : (
          sortedTags.map(([tag, confidence]) => {
            const isSelected = selectedTags.includes(tag);
            const pct = Math.round(confidence * 100);
            const isHigh = confidence >= 0.7;
            const isMedium = confidence >= 0.4 && confidence < 0.7;
            const isNormal = confidence >= 0.2 && confidence < 0.4;
            const confClass = isHigh ? "high-conf" : isMedium ? "med-conf" : isNormal ? "norm-conf" : "low-conf";
            const className = `inspector-tag-pill ${isSelected ? "selected" : ""} ${confClass} ${selectable ? "" : "is-static"}`;
            const content = (
              <>
                <span className="inspector-tag-name">{tag}</span>
                <span className="inspector-tag-conf" title={`WD Tagger 把握: ${pct}%`}>{pct}%</span>
                {selectable && (
                  <span className="inspector-tag-check" aria-hidden="true">
                    {isSelected ? "✓" : "+"}
                  </span>
                )}
              </>
            );
            return selectable ? (
              <button
                key={tag}
                type="button"
                className={className}
                aria-pressed={isSelected}
                onClick={() => toggleTag(tag)}
                title={`识别把握 ${pct}% · 点击${isSelected ? "取消选择" : "选择为探索拦截规则"}`}
              >
                {content}
              </button>
            ) : (
              <span key={tag} className={className} title={`WD Tagger 识别把握 ${pct}% · 仅代表存在把握，不等于生成权重`}>
                {content}
              </span>
            );
          })
        )}
      </div>
    </div>
  );

  if (!target) return null;

  return (
    <aside className="element-inspector-overlay" role="dialog" aria-modal="true" aria-label="AI 元素透视与提示词整理">
      <div className="element-inspector-drawer">
        {loading && <div className="inspector-scan-bar" aria-hidden="true" />}
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
              aria-label={loading ? "正在解析中" : "重新解析当前页"}
            >
              <span className={`inspector-refresh-icon ${loading ? "spinning" : ""}`} aria-hidden="true">🔄</span>
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
                ? `${runtimeStatus.visionProvider} · 图片仅在本机离线分析`
                : runtimeStatus?.visionError || "正在读取视觉引擎状态"}
            </small>
          </div>
        </div>

        {notice && <AppNotice tone="success" onDismiss={() => setNotice("")}>{notice}</AppNotice>}
        {error && <AppNotice tone="error">{error}</AppNotice>}

        {pageCount > 1 && pages.length > 1 && (
          <div className="inspector-multi-page-section">
            <div className="inspector-focus-notice">
              <span className="inspector-focus-icon" aria-hidden="true">💡</span>
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
              <span className="inspector-radar-icon" aria-hidden="true">⚡</span>
            </div>
            <div className="inspector-loading-text">
              <strong>正在深度解析 P{activePageIndex + 1} 单页特征...</strong>
              <span>WD Tagger 正在逐层提取当前单张画作的视觉特征向量</span>
            </div>
            <div className="inspector-skeleton-grid" aria-hidden="true">
              {Array.from({ length: 14 }).map((_, i) => (
                <div
                  key={i}
                  className="inspector-skeleton-chip"
                  style={{ width: `${60 + (i % 5) * 24}px`, animationDelay: `${i * 0.07}s` }}
                />
              ))}
            </div>
          </div>
        ) : error && !assessment ? (
          <div className="inspector-empty">
            <span className="inspector-empty-icon" aria-hidden="true">⚠️</span>
            <p>{error}</p>
            <Button variant="primary" onClick={() => loadAnalysis(activePageIndex)}>
              🔄 重新尝试解析
            </Button>
          </div>
        ) : assessment ? (
          <div className="inspector-workspace">
            <nav className="inspector-section-tabs" role="tablist" aria-label="元素透视功能切换">
              <button
                type="button"
                role="tab"
                aria-selected={activeSection === "features"}
                className={activeSection === "features" ? "active" : ""}
                onClick={() => setActiveSection("features")}
              >
                <span>看懂画面</span>
                <small>{rawEntries.length} 个标签</small>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeSection === "prompt"}
                className={activeSection === "prompt" ? "active" : ""}
                onClick={() => setActiveSection("prompt")}
              >
                <span>整理提示词</span>
                <small>本图临时选择</small>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeSection === "filter"}
                className={activeSection === "filter" ? "active" : ""}
                onClick={() => setActiveSection("filter")}
              >
                <span>设置探索拦截</span>
                <small>{selectedTags.length > 0 ? `已选 ${selectedTags.length} 项` : "可选规则"}</small>
              </button>
            </nav>

            {activeSection === "features" && (
              <section className="inspector-section-panel" aria-label="画面识别结果">
                <div className="inspector-section-intro">
                  <div>
                    <strong>这张图片里识别到了什么</strong>
                    <span>按识别把握从高到低排列，可以搜索或按把握区间快速筛选。</span>
                  </div>
                  <div className="inspector-intro-badge">
                    <span className="badge-pct" aria-hidden="true">%</span>
                    <p><strong>百分比</strong>表示模型识别元素存在的把握，不是生成权重。</p>
                  </div>
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
                  <div>
                    <strong>以后在探索里少看到哪些元素</strong>
                    <span>先勾选需要拦截的标签，再选择隐藏方式与触发把握。</span>
                  </div>
                  <div className="inspector-intro-badge">
                    <span className="badge-shield" aria-hidden="true">🛡️</span>
                    <p>只影响<strong>远程探索</strong>；已下载到画廊的图片始终正常清晰展示。</p>
                  </div>
                </div>
                {renderTagBrowser(true)}
                <div className="inspector-action-footer">
                  <div className="inspector-action-header">
                    <strong>
                      <span aria-hidden="true">⚙️</span> 自定义探索拦截规则
                    </strong>
                    <span className="inspector-selected-count-badge">
                      {selectedTags.length > 0 ? `已选择 ${selectedTags.length} 个标签` : "未选择标签"}
                    </span>
                  </div>
                  <div className="inspector-rule-inputs">
                    <div className="inspector-input-group">
                      <label htmlFor="inspector-action-select">命中后怎么显示</label>
                      <select
                        id="inspector-action-select"
                        className="inspector-select"
                        value={action}
                        onChange={(e) => setAction(e.target.value as "hide" | "blur")}
                      >
                        <option value="hide">遮住整张图片 (Hide)</option>
                        <option value="blur">保持模糊，可手动查看 (Blur)</option>
                      </select>
                    </div>
                    <div className="inspector-input-group">
                      <div className="inspector-slider-label-row">
                        <label htmlFor="inspector-threshold-slider">触发把握门槛</label>
                        <span className="inspector-threshold-val">{Math.round(threshold * 100)}%</span>
                      </div>
                      <input
                        id="inspector-threshold-slider"
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.05"
                        value={threshold}
                        className="inspector-slider"
                        onChange={(e) => setThreshold(parseFloat(e.target.value))}
                        aria-label={`触发把握门槛: ${Math.round(threshold * 100)}%`}
                      />
                      <small className="inspector-slider-hint">当模型识别把握达到该门槛时触发拦截</small>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    disabled={selectedTags.length === 0 || saving}
                    onClick={handleAddBlacklist}
                    className="inspector-submit-btn"
                  >
                    {saving ? "正在保存拦截规则…" : selectedTags.length === 0 ? "请先在上方勾选要拦截的元素" : `保存 ${selectedTags.length} 个探索拦截规则`}
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
