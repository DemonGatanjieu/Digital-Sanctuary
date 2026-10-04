import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalysisJob,
  AnalysisScope,
  AnalysisScopePreview,
  ArtistRecord,
  CollectionRecord,
  TriageQueryResultItem,
  WorkDeletionPreview,
  ExploreTriageResult
} from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import type { AppStatus } from "./AppSidebar";
import { Button } from "./Button";
import { SegmentedControl } from "./SegmentedControl";
import { DialogOverlay } from "./DialogOverlay";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { TRIAGE_SELECTION_LIMIT, toggleTriageSelection, visibleTriageSelection } from "./organize-selection";

type StudioTab = "triage" | "features" | "suggestions";

interface FeaturePreset {
  id: string;
  name: string;
  icon: string;
  tags: string[];
  description: string;
  badge: string;
}

const FEATURE_PRESETS: FeaturePreset[] = [
  {
    id: "sketch_mono",
    name: "单色与线稿草图",
    icon: "🎨",
    tags: ["monochrome", "sketch", "comic", "lineart"],
    description: "黑白草图、四格漫画、线稿及单色插画",
    badge: "草图/线稿"
  },
  {
    id: "chibi",
    name: "Q版与萌系四格",
    icon: "🧸",
    tags: ["chibi", "4koma", "sd_character"],
    description: "二头身、Q版角色及四格小品作品",
    badge: "萌系小品"
  },
  {
    id: "ai_3d",
    name: "3D与AI特征",
    icon: "🤖",
    tags: ["ai_generated", "3d", "blender", "miku_miku_dance"],
    description: "3D渲染模型、MMD及可识别的AI生成特征",
    badge: "合成/建模"
  },
  {
    id: "blood_guro",
    name: "血腥与异常排查",
    icon: "🩸",
    tags: ["blood", "guro", "severed_head", "severed_limb", "corpse"],
    description: "出血、内脏、肢体残缺等可能不适的内容",
    badge: "高敏防护"
  }
];

export function AnalysisView({
  collections,
  artists,
  selectedWorkIds,
  status,
  error,
  onApplied,
  onError,
  onOpenProtection,
  onRulesChanged,
  initialJobId,
  onJobOpened
}: {
  collections: CollectionRecord[];
  artists: ArtistRecord[];
  selectedWorkIds: string[];
  status: AppStatus | null;
  error: string;
  onApplied: () => Promise<void>;
  onError: (error: unknown) => void;
  onOpenProtection: () => void;
  onRulesChanged?: () => Promise<void>;
  initialJobId?: string | null;
  onJobOpened?: () => void;
}) {
  const [tab, setTab] = useState<StudioTab>(selectedWorkIds.length || initialJobId ? "suggestions" : "triage");

  // Shared Scope State
  const [scopeType, setScopeType] = useState<AnalysisScope["type"]>(selectedWorkIds.length ? "selected" : "all");
  const [artistId, setArtistId] = useState(artists[0]?.id ?? "");
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const [preview, setPreview] = useState<AnalysisScopePreview | null>(null);

  // Suggestions Mode State
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  useEffect(() => { if (initialJobId) setTab("suggestions"); }, [initialJobId]);
  useEffect(() => {
    if (!initialJobId || tab !== "suggestions" || !jobs.some((job) => job.id === initialJobId)) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`analysis-job-${initialJobId}`)?.scrollIntoView({ block: "nearest", behavior: "instant" });
      onJobOpened?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [initialJobId, jobs, tab, onJobOpened]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, string[]>>({});

  // Triage Mode State
  const [activePresetId, setActivePresetId] = useState<string>("sketch_mono");
  const [customTagInput, setCustomTagInput] = useState("");
  const [minConfidence, setMinConfidence] = useState(0.4);
  const [triageResults, setTriageResults] = useState<TriageQueryResultItem[]>([]);
  const [selectedTriageIds, setSelectedTriageIds] = useState<Set<string>>(new Set());
  const [searchingTriage, setSearchingTriage] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [deletionPreview, setDeletionPreview] = useState<WorkDeletionPreview | null>(null);
  const [deletingWorks, setDeletingWorks] = useState(false);
  const [ruleQuery, setRuleQuery] = useState<ExploreTriageResult | null>(null);
  const [queryError, setQueryError] = useState("");
  const [resultLimit, setResultLimit] = useState(40);
  const alive = useRef(true);
  const queryPending = useRef(false);
  const queryGeneration = useRef(0);

  const scope = useMemo<AnalysisScope>(() => {
    if (scopeType === "selected") return { type: "selected", workIds: selectedWorkIds };
    if (scopeType === "artist") return { type: "artist", artistId };
    if (scopeType === "collection") return { type: "collection", collectionId };
    return { type: "all" };
  }, [artistId, collectionId, scopeType, selectedWorkIds]);
  const queryKey = JSON.stringify([scope, tab, activePresetId, customTagInput, minConfidence]);
  const latestQueryKey = useRef(queryKey);
  latestQueryKey.current = queryKey;

  async function refreshJobs() {
    const next = await window.sanctuary.listAnalysisJobs();
    if (alive.current) setJobs(next);
  }

  useEffect(() => {
    alive.current = true;
    void refreshJobs().catch(onError);
    return () => { alive.current = false; queryGeneration.current++; };
  }, [onError]);
  const hasPendingJobs = jobs.some((job) => job.status === "queued" || job.status === "running");
  useEffect(() => {
    if (!hasPendingJobs) return;
    const timer = window.setInterval(() => void refreshJobs().catch(onError), 1_200);
    return () => window.clearInterval(timer);
  }, [hasPendingJobs, onError]);

  useEffect(() => {
    setPreview(null);
  }, [scope]);
  useEffect(() => {
    queryGeneration.current++;
    setQueryError("");
    setHasSearched(false); setTriageResults([]); setSelectedTriageIds(new Set()); setRuleQuery(null); setResultLimit(40);
  }, [queryKey]);

  async function previewScope() {
    const requestedScope = JSON.stringify(scope);
    setBusy(true);
    setNotice("");
    try {
      const next = await window.sanctuary.previewAnalysis(scope);
      if (alive.current && JSON.stringify(scope) === requestedScope && latestQueryKey.current === queryKey) setPreview(next);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function startJob() {
    if (!preview || preview.assetCount === 0 || JSON.stringify(preview.scope) !== JSON.stringify(scope)) return;
    setBusy(true);
    try {
      const job = await window.sanctuary.createAnalysisJob(preview.scope);
      await window.sanctuary.startAnalysisJob(job.id);
      setPreview(null);
      setNotice("整理任务已经进入队列。模型只写入独立分析结果，不会改变作品的可信状态。");
      await refreshJobs();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function applySuggestions(job: AnalysisJob) {
    const ids = selectedSuggestions[job.id] ?? [];
    if (!ids.length) return;
    setBusy(true);
    try {
      const result = await window.sanctuary.applyAnalysisSuggestions(job.id, ids);
      setSelectedSuggestions((current) => ({ ...current, [job.id]: [] }));
      setNotice(`已确认 ${ids.length} 条建议，整理了 ${result.affectedWorkCount} 个作品。`);
      await onApplied();
      await refreshJobs();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  // Triage Search
  async function runTriageQuery() {
    if (queryPending.current) return;
    queryPending.current = true;
    const generation = ++queryGeneration.current;
    const requestedKey = queryKey;
    setSearchingTriage(true);
    setQueryError("");
    setNotice("");
    try {
      if (tab === "triage") {
        const result = await window.sanctuary.queryTriageByExploreRules(scope);
        if (!alive.current || generation !== queryGeneration.current || requestedKey !== latestQueryKey.current) return;
        setRuleQuery(result); setTriageResults(result.items); setSelectedTriageIds(new Set()); setHasSearched(true); setResultLimit(40);
        return;
      }
      let targetTags: string[] = [];
      if (activePresetId === "custom") {
        targetTags = customTagInput.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
      } else {
        const preset = FEATURE_PRESETS.find((p) => p.id === activePresetId);
        targetTags = preset ? preset.tags : [];
      }

      if (!targetTags.length) {
        setNotice("请选择或输入至少一个特征标签。");
        setTriageResults([]);
        return;
      }

      const results = await window.sanctuary.queryTriageWorks({
        tags: targetTags,
        minConfidence,
        scope
      });
      if (!alive.current || generation !== queryGeneration.current || requestedKey !== latestQueryKey.current) return;
      setTriageResults(results);
      setSelectedTriageIds(new Set());
      setHasSearched(true);
      if (results.length === 0) {
        setNotice("在当前已分析的图库中未匹配到符合条件的作品。若未进行过模型分析，可先在「推荐相册分类」中运行分析任务。");
      }
    } catch (err) {
      if (alive.current && requestedKey === latestQueryKey.current) setQueryError(err instanceof Error ? err.message : "查找失败，请重试。");
    } finally {
      queryPending.current = false;
      if (alive.current) setSearchingTriage(false);
    }
  }

  // Batch delete selected triage items
  async function prepareTriageDeletion() {
    const workIds = [...selectedTriageIds];
    if (!workIds.length) return;
    setBusy(true);
    try {
      const prev = await window.sanctuary.previewWorkDeletion(workIds);
      setDeletionPreview(prev);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirmTriageDeletion() {
    if (!deletionPreview) return;
    setDeletingWorks(true);
    try {
      const result = await window.sanctuary.confirmWorkDeletion(deletionPreview.token);
      setDeletionPreview(null);
      setSelectedTriageIds(new Set());
      await onApplied();
      await runTriageQuery();
      setSelectedTriageIds(new Set(result.failures.map((item) => item.workId)));
      setNotice(`已处理 ${result.completedWorkIds.length} 个作品，${result.trashedFileCount} 个托管文件移入回收站。${result.failures.length ? `另有 ${result.failures.length} 件未完成，已保留选择供重试。` : ""}`);
    } catch (err) {
      onError(err);
    } finally {
      setDeletingWorks(false);
    }
  }

  // Batch assign selected triage items to collection
  async function assignTriageToCollection(targetCollectionId: string) {
    if (!targetCollectionId || selectedTriageIds.size === 0) return;
    setBusy(true);
    try {
      const selected = [...selectedTriageIds];
      const failed: string[] = [];
      for (let offset = 0; offset < selected.length; offset += 8) {
        const batch = selected.slice(offset, offset + 8);
        const outcomes = await Promise.allSettled(batch.map((id) => window.sanctuary.addWorkToCollection(id, targetCollectionId)));
        outcomes.forEach((outcome, index) => { if (outcome.status === "rejected") failed.push(batch[index]!); });
      }
      const colName = collections.find((c) => c.id === targetCollectionId)?.name ?? "目标相册";
      setNotice(`已将 ${selected.length - failed.length} 件作品加入《${colName}》。${failed.length ? `另有 ${failed.length} 件失败，已保留选择供重试。` : ""}`);
      setSelectedTriageIds(new Set(failed));
      await onApplied();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  // Add active preset tags to global custom blacklist
  async function addTriageTagsToBlacklist() {
    let targetTags: string[] = [];
    if (activePresetId === "custom") {
      targetTags = customTagInput.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
    } else {
      const preset = FEATURE_PRESETS.find((p) => p.id === activePresetId);
      targetTags = preset ? preset.tags : [];
    }
    if (!targetTags.length) return;
    setBusy(true);
    try {
      for (const tag of targetTags) {
        await window.sanctuary.addCustomBlacklistTag({
          tag,
          threshold: minConfidence,
          action: "hide",
          groupName: "用户自定义拦截"
        });
      }
      await onRulesChanged?.();
      setNotice(`已将标签 [${targetTags.join(", ")}] 同步加入全局探索拦截黑名单！`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  const toggleSelectTriageItem = (id: string) => {
    setSelectedTriageIds((current) => toggleTriageSelection(current, id));
  };

  const selectableTriageIds = useMemo(() => visibleTriageSelection(
    triageResults.slice(0, Math.min(resultLimit, TRIAGE_SELECTION_LIMIT)).map((item) => item.work.id), resultLimit
  ), [triageResults, resultLimit]);
  const allVisibleSelected = selectableTriageIds.size > 0 && [...selectableTriageIds].every((id) => selectedTriageIds.has(id));
  const selectAllTriage = () => {
    if (allVisibleSelected) {
      setSelectedTriageIds(new Set());
    } else {
      setSelectedTriageIds(selectableTriageIds);
    }
  };

  const scopeControls = <>
    <p className="organize-scope-summary">{scopeLabel(scope, collections, artists)}{scopeType === "selected" ? " · " + selectedWorkIds.length + " 项已选" : ""}</p>
    <SettingsDisclosure title="更换整理范围" name="organize-scope">
      <label className="organize-field">整理范围<select aria-label="整理范围" value={scopeType} disabled={busy}
        onChange={(event) => setScopeType(event.target.value as AnalysisScope["type"])}>
        <option value="all">全部图库</option><option value="selected" disabled={!selectedWorkIds.length}>画廊已选</option>
        <option value="collection" disabled={!collections.length}>指定相册</option><option value="artist" disabled={!artists.length}>指定画师</option>
      </select></label>
      {scopeType === "collection" && <label className="organize-field">相册<select aria-label="整理相册" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
        {collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>}
      {scopeType === "artist" && <label className="organize-field">画师<select aria-label="整理画师" value={artistId} onChange={(event) => setArtistId(event.target.value)}>
        {artists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>}
    </SettingsDisclosure>
  </>;
  const invalidScope = (scopeType === "selected" && !selectedWorkIds.length) || (scopeType === "artist" && !artistId) || (scopeType === "collection" && !collectionId);
  return <div className="studio-root organize-simple">
    <header className="topbar studio-topbar">
      <div><h1>整理与分类</h1><p className="page-description">先找出作品，再决定怎样整理。</p></div>
    </header>
    {error && <AppNotice tone="error">{error}</AppNotice>}
    {queryError && <AppNotice tone="error" onDismiss={() => setQueryError("")}>{queryError}</AppNotice>}
    {notice && <AppNotice tone="info" onDismiss={() => setNotice("")}>{notice}</AppNotice>}
    <SegmentedControl label="整理方式" value={tab} options={[
      {value: "triage", label: "按探索规则排查"}, {value: "features", label: "按特征查找"}, {value: "suggestions", label: "推荐相册分类"}
    ]} onChange={(value) => { if (!busy && !deletingWorks) setTab(value as StudioTab); }} />
    <div className="studio-layout">
      <section className="analysis-scope-card studio-control-deck">
        {tab === "suggestions" && <h2>选择要整理的范围</h2>}
        {scopeControls}
        {tab === "triage" ? <>
          <div className="organize-rule-summary"><strong>默认使用探索的元素规则</strong>
            <p>复用已启用的内容、各自阈值与自定义标签。只列出命中的本地作品，处理前由你选择。</p>
            <Button variant="ghost" size="small" onClick={onOpenProtection}>在探索调整规则</Button>
          </div>
          <Button variant="primary" className="studio-primary-action-btn" busy={searchingTriage} disabled={busy || invalidScope} onClick={() => void runTriageQuery()}>查找需要关注的作品</Button>
          {ruleQuery && <div className="organize-query-coverage">
            <p>{ruleQuery.ruleNames.length ? "本次使用：" + ruleQuery.ruleNames.join("、") : "探索元素规则均已关闭。"}</p>
            <p>当前模型已分析 {ruleQuery.preview.cachedAssetCount} / {ruleQuery.preview.assetCount} 张图片</p>
            {ruleQuery.preview.cachedAssetCount < ruleQuery.preview.assetCount && <Button variant="secondary" size="small" onClick={() => setTab("suggestions")}>补充图片分析</Button>}
          </div>}
        </> : tab === "features" ? <>
          <div className="organize-feature-choices" aria-label="查找特征">
            {FEATURE_PRESETS.map((preset) => <button type="button" key={preset.id} aria-pressed={activePresetId === preset.id}
              onClick={() => setActivePresetId(preset.id)}><strong>{preset.name}</strong><small>{preset.description}</small></button>)}
          </div>
          <SettingsDisclosure title="高级查找选项" description="自定义标签与精确阈值。" name="organize-features">
            <label className="organize-field">查找方式<select aria-label="特征查找方式" value={activePresetId} onChange={(event) => setActivePresetId(event.target.value)}>
              {FEATURE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}<option value="custom">自定义标签</option>
            </select></label>
            {activePresetId === "custom" && <label className="organize-field">识别标签<input aria-label="自定义特征标签" placeholder="英文标签，逗号分隔" value={customTagInput} onChange={(event) => setCustomTagInput(event.target.value)} /></label>}
            <label className="organize-field">检出阈值 {Math.round(minConfidence * 100)}%<input aria-label="特征检出阈值" type="range" min="0.1" max="0.9" step="0.05" value={minConfidence} onChange={(event) => setMinConfidence(Number(event.target.value))} /></label>
            <p className="protection-section-hint">这些参数只影响本次查找。阈值越低，越容易找到不确定的结果。</p>
            <Button variant="secondary" size="small" disabled={busy} onClick={() => void addTriageTagsToBlacklist()}>将当前特征加入探索规则</Button>
          </SettingsDisclosure>
          <Button variant="primary" className="studio-primary-action-btn" busy={searchingTriage} disabled={busy || invalidScope} onClick={() => void runTriageQuery()}>查找作品</Button>
        </> : <>
          <p className="protection-section-hint">先预览作品数量，再决定是否运行本地分析。完成后勾选想采用的相册建议。</p>
          <Button className="studio-preview-action-btn" busy={busy} disabled={invalidScope} onClick={() => void previewScope()}>预览分析范围</Button>
                      {preview && JSON.stringify(preview.scope) === JSON.stringify(scope) && (
              <div className="studio-estimator-card">
                <div className="studio-estimator-header">
                  <span className="studio-estimator-icon">⚡</span>
                  <strong>任务工作量测算</strong>
                </div>

                <div className="studio-estimator-grid">
                  <div className="studio-metric-box">
                    <span>作品数</span>
                    <strong>{preview.workCount}</strong>
                  </div>
                  <div className="studio-metric-box">
                    <span>图片总页</span>
                    <strong>{preview.assetCount}</strong>
                  </div>
                  <div className="studio-metric-box accent-green">
                    <span>已缓存免算</span>
                    <strong>{preview.cachedAssetCount}</strong>
                  </div>
                  <div className="studio-metric-box accent-blue">
                    <span>需全新推理</span>
                    <strong>{Math.max(0, preview.assetCount - preview.cachedAssetCount)}</strong>
                  </div>
                </div>

                <p className="studio-estimator-desc">
                  {preview.assetCount === 0
                    ? "该范围内暂无可分析的图片。"
                    : "任务将由本地显卡/CPU离线运行，进度实时保存，可随时中断。"}
                </p>

                <Button
                  variant="primary"
                  busy={busy}
                  busyLabel="正在创建任务…"
                  disabled={preview.assetCount === 0 || !status?.visionReady || !status.modelBacked}
                  onClick={() => void startJob()}
                  className="studio-launch-action-btn"
                >
                  开始图片分析
                </Button>
                {(!status?.visionReady || !status.modelBacked) && <Button variant="secondary" size="small" onClick={onOpenProtection}>检查识别模型</Button>}
              </div>
            )}

        </>}
      </section>
      {tab === "suggestions" ? <>          {/* Right Column: Job Center & Suggestions */}
          <section className="studio-stage-workbench">
            <header className="studio-workbench-header">
              <div className="studio-workbench-title-box">
                <div className="studio-workbench-heading-row">
                  <span className="studio-badge-indicator" />
                  <h2>分析任务与相册建议</h2>
                </div>
                <span className="studio-workbench-sub">
                  分析结束后，由你选择采用哪些相册建议。
                </span>
              </div>
            </header>

            <div className="studio-jobs-column">
              {jobs.length === 0 ? (
                <div className="studio-empty-hero">
                  <div className="studio-empty-orb">
                    <span className="studio-empty-orb-icon">☕</span>
                  </div>
                  <h3>还没有整理任务</h3>
                  <p>
                    先预览分析范围，确认数量后再开始。
                    <br />
                    分析进度会保存；运行中的任务可以取消。
                  </p>
                </div>
              ) : (
                jobs.map((job) => {
                  const progress = job.totalItems ? Math.round((job.processedItems / job.totalItems) * 100) : 100;
                  const chosen = selectedSuggestions[job.id] ?? [];
                  return (
                    <article className="studio-job-card" id={`analysis-job-${job.id}`} key={job.id}>
                      <header className="studio-job-card-top">
                        <div className="studio-job-meta">
                          <span className={`analysis-status ${job.status}`}>
                            {statusLabel(job.status)}
                          </span>
                          <strong className="studio-job-scope-name">
                            {scopeLabel(job.scope, collections, artists)}
                          </strong>
                          <small className="studio-job-timestamp">
                            {job.engine} · {new Date(job.createdAt).toLocaleString("zh-CN")}
                          </small>
                        </div>
                        {(job.status === "queued" || job.status === "running") && (
                          <Button
                            size="small"
                            variant="danger-soft"
                            onClick={() =>
                              void window.sanctuary
                                .cancelAnalysisJob(job.id)
                                .then(refreshJobs)
                                .catch(onError)
                            }
                          >
                            取消任务
                          </Button>
                        )}
                      </header>

                      <div className="studio-job-progress">
                        <span style={{ width: `${progress}%` }} />
                      </div>

                      <div className="studio-job-metrics-row">
                        <span>{job.processedItems} / {job.totalItems} 图片</span>
                        <span>⚡ {job.cacheHits} 次缓存命中</span>
                        {job.failedItems > 0 && <span className="text-danger">⚠️ {job.failedItems} 个失败</span>}
                        <span className="studio-job-percent">{progress}%</span>
                      </div>

                      {job.error && <AppNotice tone="error">{job.error}</AppNotice>}

                      {job.status === "completed" && (
                        <div className="studio-suggestions-block">
                          <div className="studio-suggestions-heading">
                            <strong>💡 聚合相册建议</strong>
                            <small>勾选后点击确认，将自动批量建立分类并收纳对应画作。</small>
                          </div>

                          {job.suggestions.length === 0 ? (
                            <p className="studio-no-suggestions">这次分析没有生成足够明确的相册建议。</p>
                          ) : (
                            <div className="studio-suggestions-grid">
                              {job.suggestions.map((suggestion) => {
                                const isChecked = chosen.includes(suggestion.id);
                                return (
                                  <label
                                    key={suggestion.id}
                                    className={`studio-suggestion-card ${isChecked ? "checked" : ""}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(event) =>
                                        setSelectedSuggestions((current) => ({
                                          ...current,
                                          [job.id]: event.target.checked
                                            ? [...chosen, suggestion.id]
                                            : chosen.filter((id) => id !== suggestion.id)
                                        }))
                                      }
                                    />
                                    <div className="studio-suggestion-info">
                                      <strong>{suggestion.label.replaceAll("_", " ")}</strong>
                                  <small>{suggestion.workIds.length} 个作品</small>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          )}

                          {job.suggestions.length > 0 && (
                            <div className="studio-suggestions-actions">
                              <Button
                                variant="primary"
                                disabled={!chosen.length || busy}
                                onClick={() => void applySuggestions(job)}
                              >
                                ✨ 确认所选建议并建立相册 ({chosen.length})
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </section>
</> : <>          {/* Right Column: Stage Workbench */}
          <section className="studio-stage-workbench">
            <header className="studio-workbench-header">
              <div className="studio-workbench-title-box">
                <div className="studio-workbench-heading-row">
                  <span className="studio-badge-indicator" />
                  <h2>查找结果</h2>
                </div>
                <div className="studio-results-counter">
                  <span>共命中</span>
                  <strong>{triageResults.length}</strong>
                  <span>个作品</span>
                  {selectedTriageIds.size > 0 && (
                    <span className="studio-selected-badge">
                      已选中 <b>{selectedTriageIds.size}</b> 项
                      <button
                        type="button"
                        className="studio-badge-clear"
                        onClick={() => setSelectedTriageIds(new Set())}
                        title="取消全部勾选"
                      >
                        ✕
                      </button>
                    </span>
                  )}
                </div>
              </div>

              {triageResults.length > 0 && (
                <div className="studio-batch-toolbar">
                  <Button
                    size="small"
                    variant="ghost"
                    className="studio-batch-btn"
                    disabled={busy}
                    onClick={selectAllTriage}
                  >
                    {allVisibleSelected ? "取消全选" : `选择已展示的 ${selectableTriageIds.size} 件`}
                  </Button>

                  <div className="studio-batch-select-wrap">
                    <select
                      className="studio-batch-select"
                      value=""
                      disabled={busy || selectedTriageIds.size === 0 || collections.length === 0}
                      onChange={(e) => void assignTriageToCollection(e.target.value)}
                    >
                      <option value="">📁 批量归档至相册…</option>
                      {collections.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <Button
                    size="small"
                    variant="danger-soft"
                    className="studio-batch-delete-btn"
                    disabled={busy || selectedTriageIds.size === 0}
                    onClick={() => void prepareTriageDeletion()}
                  >
                    🗑️ 移入回收站 ({selectedTriageIds.size})
                  </Button>
                </div>
              )}
              {selectedTriageIds.size >= TRIAGE_SELECTION_LIMIT && <p className="organize-scope-summary">每批最多选择 500 件，请先处理这一批，或缩小整理范围。</p>}
            </header>

            {!hasSearched ? (
              <div className="studio-empty-hero">
                <div className="studio-empty-orb">
                  <span className="studio-empty-orb-icon">🧭</span>
                </div>
                <h3>{tab === "triage" ? "用你的探索规则检查图库" : "找出同一类作品"}</h3>
                <p>
                  {tab === "triage" ? "点击查找，先看看哪些已分析作品命中了当前元素规则。" : "选择一种特征，点击查找；需要精确调整时再展开高级选项。"}
                  <br />
                  查找使用已有图片分析。你选择处理方式后才会改变图库。
                </p>
                <div className="studio-workflow-steps">
                  <div className="studio-step-node">
                    <span>1</span>
                    <em>选择范围</em>
                  </div>
                  <div className="studio-step-connector">⋯</div>
                  <div className="studio-step-node">
                    <span>2</span>
                    <em>查看结果</em>
                  </div>
                  <div className="studio-step-connector">⋯</div>
                  <div className="studio-step-node">
                    <span>3</span>
                    <em>选择处理方式</em>
                  </div>
                </div>
              </div>
            ) : triageResults.length === 0 ? (
              <div className="studio-empty-hero">
                <div className="studio-empty-orb">
                  <span className="studio-empty-orb-icon">🍃</span>
                </div>
                <h3>{ruleQuery?.ruleNames.length === 0 ? "还没有启用探索元素规则" : ruleQuery && ruleQuery.preview.cachedAssetCount < ruleQuery.preview.assetCount ? "已分析的图片中没有命中" : "没有找到符合条件的作品"}</h3>
                <p>
                  {ruleQuery ? ruleQuery.preview.assetCount === 0 ? "这个范围还没有可分析的图片。" : ruleQuery.preview.cachedAssetCount < ruleQuery.preview.assetCount ? "仍有图片没有当前模型的分析结果；补充分析后再来查找。" : "当前已分析图片没有命中所选规则。" : "已分析图片没有达到本次查找条件。"}
                  <br />
                  {tab === "features" && "也可以换一种特征，或到推荐相册分类补充图片分析。"}
                </p>
              </div>
            ) : (
              <div className="studio-cards-grid">
                {triageResults.slice(0, resultLimit).map((item) => {
                  const isChecked = selectedTriageIds.has(item.work.id);
                  const coverPath = item.work.coverAsset?.thumbnailPath ?? item.work.coverAsset?.path ?? "";
                  const imageUrl = coverPath ? `sanctuary-image://local/${encodeURIComponent(coverPath)}` : "";
                  const topTag = item.matchedTags[0];

                  return (
                    <article
                      key={item.work.id}
                      className={`studio-work-card ${isChecked ? "selected" : ""}`}
                      onClick={() => { if (!busy) toggleSelectTriageItem(item.work.id); }}
                    >
                      <div className="studio-card-media">
                        {imageUrl ? (
                          <img src={imageUrl} alt="" loading="lazy" />
                        ) : (
                          <div className="work-cover-missing">◇</div>
                        )}
                        {topTag && (
                          <span className="studio-card-top-badge">
                            {tab === "triage" ? "命中探索元素规则" : "匹配所选特征"}
                          </span>
                        )}
                        <button
                          type="button"
                          className="studio-card-checkbox"
                          aria-label={isChecked ? "取消勾选" : "勾选"}
                          disabled={busy || (!isChecked && selectedTriageIds.size >= TRIAGE_SELECTION_LIMIT)}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectTriageItem(item.work.id);
                          }}
                        >
                          {isChecked && <span className="studio-check-symbol">✓</span>}
                        </button>
                      </div>

                      <div className="studio-card-info">
                        <strong className="studio-card-title" title={item.work.title}>
                          {item.work.title}
                        </strong>
                        <small className="studio-card-artist" title={item.work.artistName ?? ""}>
                          {item.work.artistName ?? "本地画作"}
                        </small>

                        <details className="studio-card-tags" onClick={(event) => event.stopPropagation()}><summary>识别依据</summary>
                          {item.matchedTags.map((mt) => (
                            <span key={mt.tag} className="studio-card-tag-pill">
                              {mt.tag.replaceAll("_", " ")} <em>{Math.round(mt.confidence * 100)}%</em>
                            </span>
                          ))}
                        </details>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {triageResults.length > resultLimit && <Button variant="secondary" disabled={busy} onClick={() => setResultLimit((limit) => limit + 40)}>显示更多作品</Button>}
          </section></>}
    </div>
      {/* Work Deletion Dialog for Triage */}
      {deletionPreview && (
        <DialogOverlay busy={deletingWorks} onClose={() => setDeletionPreview(null)}>
          <section className="dialog-surface work-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="triage-delete-title">
            <p className="eyebrow">处理预览</p>
            <h2 id="triage-delete-title">确认处理排查出的 {deletionPreview.items.length} 个作品？</h2>
            <div className="work-delete-summary">
              <div><strong>{deletionPreview.managedWorkCount}</strong><span>托管作品</span><small>文件移至 Windows 回收站</small></div>
              <div><strong>{deletionPreview.externalWorkCount}</strong><span>外部导入</span><small>只移除索引，不碰原文件</small></div>
              <div><strong>{deletionPreview.fileCount}</strong><span>图片文件</span><small>{deletionPreview.items.length} 项</small></div>
            </div>
            <div className="work-delete-list">
              {deletionPreview.items.slice(0, 6).map((item) => (
                <div key={item.id}><span>{item.title}</span><small>{item.ownership === "managed" ? "移至回收站" : "仅移除索引"} · {item.fileCount} 页</small></div>
              ))}
              {deletionPreview.items.length > 6 && <p>以及另外 {deletionPreview.items.length - 6} 个作品</p>}
            </div>
            <p className="work-delete-warning">不会永久销毁托管文件；需要恢复时可前往 Windows 回收站。</p>
            <footer>
              <Button disabled={deletingWorks} onClick={() => setDeletionPreview(null)}>取消</Button>
              <Button variant="danger" busy={deletingWorks} busyLabel="正在处理…" onClick={() => void confirmTriageDeletion()}>确认处理</Button>
            </footer>
          </section>
        </DialogOverlay>
      )}
    </div>;
}

function statusLabel(status: AnalysisJob["status"]): string {
  return { queued: "等待开始", running: "分析中", completed: "已完成", cancelled: "已取消", failed: "中断" }[status];
}

function scopeLabel(scope: AnalysisScope, collections: CollectionRecord[], artists: ArtistRecord[]): string {
  if (scope.type === "selected") return `所选 ${scope.workIds.length} 个作品`;
  if (scope.type === "collection") return `分类 · ${collections.find((item) => item.id === scope.collectionId)?.name ?? "已删除分类"}`;
  if (scope.type === "artist") return `作者 · ${artists.find((item) => item.id === scope.artistId)?.name ?? "未知作者"}`;
  return "整个画廊";
}
