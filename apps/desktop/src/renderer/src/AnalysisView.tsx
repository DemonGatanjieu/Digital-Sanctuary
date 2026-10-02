import { useEffect, useMemo, useState } from "react";
import type {
  AnalysisJob,
  AnalysisScope,
  AnalysisScopePreview,
  ArtistRecord,
  CollectionRecord,
  TriageQueryResultItem,
  WorkDeletionPreview
} from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import type { AppStatus } from "./AppSidebar";
import { Button } from "./Button";
import { SegmentedControl } from "./SegmentedControl";
import { DialogOverlay } from "./DialogOverlay";

type StudioTab = "triage" | "suggestions";

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

const POPULAR_TAG_SUGGESTIONS = [
  "glasses",
  "swimsuit",
  "weapon",
  "wings",
  "animal_ears",
  "school_uniform",
  "comic",
  "scenery"
];

export function AnalysisView({
  collections,
  artists,
  selectedWorkIds,
  status,
  error,
  onApplied,
  onError
}: {
  collections: CollectionRecord[];
  artists: ArtistRecord[];
  selectedWorkIds: string[];
  status: AppStatus | null;
  error: string;
  onApplied: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [tab, setTab] = useState<StudioTab>(selectedWorkIds.length ? "suggestions" : "triage");

  // Shared Scope State
  const [scopeType, setScopeType] = useState<AnalysisScope["type"]>(selectedWorkIds.length ? "selected" : "all");
  const [artistId, setArtistId] = useState(artists[0]?.id ?? "");
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const [preview, setPreview] = useState<AnalysisScopePreview | null>(null);

  // Suggestions Mode State
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
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

  const scope = useMemo<AnalysisScope>(() => {
    if (scopeType === "selected") return { type: "selected", workIds: selectedWorkIds };
    if (scopeType === "artist") return { type: "artist", artistId };
    if (scopeType === "collection") return { type: "collection", collectionId };
    return { type: "all" };
  }, [artistId, collectionId, scopeType, selectedWorkIds]);

  async function refreshJobs() {
    setJobs(await window.sanctuary.listAnalysisJobs());
  }

  useEffect(() => {
    void refreshJobs().catch(onError);
    const timer = window.setInterval(() => void refreshJobs().catch(onError), 1_200);
    return () => window.clearInterval(timer);
  }, [onError]);

  useEffect(() => {
    setPreview(null);
  }, [scope]);

  async function previewScope() {
    setBusy(true);
    setNotice("");
    try {
      setPreview(await window.sanctuary.previewAnalysis(scope));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function startJob() {
    if (!preview || preview.assetCount === 0) return;
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
    setSearchingTriage(true);
    setNotice("");
    try {
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

      setTriageResults(results);
      setSelectedTriageIds(new Set());
      setHasSearched(true);
      if (results.length === 0) {
        setNotice("在当前已分析的图库中未匹配到符合条件的作品。若未进行过模型分析，可先在「推荐相册分类」中运行分析任务。");
      }
    } catch (err) {
      onError(err);
    } finally {
      setSearchingTriage(false);
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
      setNotice(`已成功处理 ${result.completedWorkIds.length} 个作品（${result.trashedFileCount} 个文件已移入系统回收站）。`);
      setDeletionPreview(null);
      setSelectedTriageIds(new Set());
      await onApplied();
      await runTriageQuery();
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
      await Promise.all([...selectedTriageIds].map((id) => window.sanctuary.addWorkToCollection(id, targetCollectionId)));
      const colName = collections.find((c) => c.id === targetCollectionId)?.name ?? "目标相册";
      setNotice(`已将 ${selectedTriageIds.size} 个画作批量归档至《${colName}》。`);
      setSelectedTriageIds(new Set());
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
      setNotice(`已将标签 [${targetTags.join(", ")}] 同步加入全局探索拦截黑名单！`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  const toggleSelectTriageItem = (id: string) => {
    setSelectedTriageIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllTriage = () => {
    if (selectedTriageIds.size === triageResults.length) {
      setSelectedTriageIds(new Set());
    } else {
      setSelectedTriageIds(new Set(triageResults.map((r) => r.work.id)));
    }
  };

  const appendCustomTag = (tag: string) => {
    setCustomTagInput((prev) => {
      const existing = prev.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
      if (existing.includes(tag)) return prev;
      return existing.length ? `${existing.join(", ")}, ${tag}` : tag;
    });
  };

  const SCOPE_OPTIONS = [
    { id: "all" as const, label: "全部画库", hint: "全量本地作品", icon: "🌐" },
    { id: "selected" as const, label: "画廊已选", hint: selectedWorkIds.length ? `${selectedWorkIds.length} 项已选` : "需先在画廊多选", icon: "✨", disabled: !selectedWorkIds.length },
    { id: "collection" as const, label: "指定相册", hint: "按相册范围", icon: "📁", disabled: !collections.length },
    { id: "artist" as const, label: "指定画师", hint: "按作者作品", icon: "👤", disabled: !artists.length }
  ];

  return (
    <div className="studio-root">
      {/* Top Header */}
      <header className="topbar studio-topbar">
        <div className="studio-topbar-title">
          <div className="studio-brand-badge">
            <span className="studio-pulse-orb" />
            <p className="eyebrow">INTELLIGENT STUDIO</p>
          </div>
          <h1>整理与分类</h1>
          <p className="page-description">
            按标签查找作品，或让模型推荐相册分类。先预览范围，再决定如何处理。
          </p>
        </div>

        <div className="studio-topbar-controls">
          <SegmentedControl
            label="整理方式"
            value={tab}
            options={[
              { value: "triage", label: "按标签查找", title: "按特征标签查找并批量处理图片" },
              { value: "suggestions", label: "推荐相册分类", title: "先运行模型分析，再确认相册分类建议" }
            ]}
            onChange={(val) => setTab(val as StudioTab)}
          />

          <div className="studio-engine-badge" title="当前视觉引擎驱动状态">
            <div className="studio-engine-status-indicator" />
            <div className="studio-engine-info">
              <span>{status?.visionProvider ?? "准备中"}</span>
              <strong>{status?.visionEngine ?? "视觉引擎"}</strong>
            </div>
          </div>
        </div>
      </header>

      {error && <AppNotice tone="error">{error}</AppNotice>}
      {notice && <AppNotice tone="success" onDismiss={() => setNotice("")}>{notice}</AppNotice>}

      {tab === "triage" ? (
        /* =================== TAB 1: 智能清洗与排查 (灵动排查台) =================== */
        <div className="studio-layout">
          {/* Left Column: Control Deck (Retains .analysis-scope-card for benchmark & smoke tests) */}
          <section className="analysis-scope-card studio-control-deck">
            <div className="studio-deck-header">
              <div>
                <p className="eyebrow">CONTROL DECK · 控制台</p>
                <h2>排查配置与条件</h2>
              </div>
              <span className="studio-safe-pill" title="所有检索均为只读安全查询">🛡️ 安全沙箱</span>
            </div>

            {/* Step 1: Scan Scope */}
            <div className="studio-section-block">
              <span className="studio-block-label">1 · 扫描范围</span>
              <div className="studio-scope-grid">
                {SCOPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={opt.disabled}
                    className={`studio-scope-btn ${scopeType === opt.id ? "active" : ""}`}
                    onClick={() => setScopeType(opt.id)}
                  >
                    <span className="studio-scope-icon">{opt.icon}</span>
                    <span className="studio-scope-texts">
                      <strong>{opt.label}</strong>
                      <small>{opt.hint}</small>
                    </span>
                  </button>
                ))}
              </div>

              {scopeType === "collection" && (
                <div className="studio-subselect-frame">
                  <span className="studio-subselect-icon">📁</span>
                  <select
                    className="studio-native-select"
                    value={collectionId}
                    onChange={(e) => setCollectionId(e.target.value)}
                  >
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {scopeType === "artist" && (
                <div className="studio-subselect-frame">
                  <span className="studio-subselect-icon">👤</span>
                  <select
                    className="studio-native-select"
                    value={artistId}
                    onChange={(e) => setArtistId(e.target.value)}
                  >
                    {artists.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Step 2: Feature Presets */}
            <div className="studio-section-block">
              <span className="studio-block-label">2 · 目标特征</span>
              <div className="studio-presets-grid">
                {FEATURE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`studio-preset-card ${activePresetId === preset.id ? "active" : ""}`}
                    onClick={() => setActivePresetId(preset.id)}
                  >
                    <div className="studio-preset-card-top">
                      <span className="studio-preset-card-icon">{preset.icon}</span>
                      <div className="studio-preset-card-title-wrap">
                        <strong>{preset.name}</strong>
                        <small>{preset.badge}</small>
                      </div>
                    </div>
                    <div className="studio-preset-tags-preview">
                      {preset.tags.slice(0, 2).map((t) => (
                        <span key={t} className="studio-mini-tag">{t}</span>
                      ))}
                      {preset.tags.length > 2 && (
                        <span className="studio-mini-tag">+{preset.tags.length - 2}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              <button
                type="button"
                className={`studio-preset-card studio-custom-trigger ${activePresetId === "custom" ? "active" : ""}`}
                onClick={() => setActivePresetId("custom")}
              >
                <div className="studio-preset-card-top">
                  <span className="studio-preset-card-icon">🔍</span>
                  <div className="studio-preset-card-title-wrap">
                    <strong>自定义特征标签</strong>
                    <small>输入任意 WD Tag 关键词自由排查</small>
                  </div>
                  <span className="studio-preset-badge">自由探索</span>
                </div>
              </button>

              {activePresetId === "custom" && (
                <div className="studio-custom-panel">
                  <input
                    type="text"
                    className="studio-custom-input"
                    placeholder="输入 Tag 英文关键词，如 cat_ears, swimsuit, monochrome"
                    value={customTagInput}
                    onChange={(e) => setCustomTagInput(e.target.value)}
                  />
                  <div className="studio-custom-hints">
                    <span>快捷标签：</span>
                    {POPULAR_TAG_SUGGESTIONS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="studio-hint-tag-btn"
                        onClick={() => appendCustomTag(tag)}
                      >
                        +{tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Step 3: Confidence Slider */}
            <div className="studio-section-block">
              <div className="studio-slider-header">
                <span className="studio-block-label">3 · 检出阈值灵敏度</span>
                <span className="studio-slider-value-pill">{Math.round(minConfidence * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                className="studio-slider-input"
              />
              <div className="studio-slider-hints-row">
                <span>10% 宽松</span>
                <span className="studio-slider-qualitative">
                  {minConfidence < 0.3
                    ? "宽松检出 · 覆盖面广"
                    : minConfidence <= 0.6
                    ? "均衡推荐 · 兼顾准度与召回"
                    : "严格确信 · 仅高置信度"}
                </span>
                <span>90% 严苛</span>
              </div>
            </div>

            {/* Action Bottom Bar */}
            <div className="studio-deck-actions">
              <Button
                variant="primary"
                className="studio-primary-action-btn"
                busy={searchingTriage}
                busyLabel="正在扫描排查..."
                onClick={() => void runTriageQuery()}
              >
                ⚡ 开始特征排查
              </Button>

              <button
                type="button"
                className="studio-shield-action-btn"
                title="将当前选择的目标特征同步加入全局探索拦截规则（不会修改本地画库）"
                onClick={() => void addTriageTagsToBlacklist()}
              >
                <span className="studio-shield-icon">🛡️</span>
                <span>同步此特征至探索拦截黑名单</span>
              </button>
            </div>
          </section>

          {/* Right Column: Stage Workbench */}
          <section className="studio-stage-workbench">
            <header className="studio-workbench-header">
              <div className="studio-workbench-title-box">
                <div className="studio-workbench-heading-row">
                  <span className="studio-badge-indicator" />
                  <h2>排查结果与画作展台</h2>
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
                    onClick={selectAllTriage}
                  >
                    {selectedTriageIds.size === triageResults.length ? "取消全选" : `全选 (${triageResults.length})`}
                  </Button>

                  <div className="studio-batch-select-wrap">
                    <select
                      className="studio-batch-select"
                      value=""
                      disabled={selectedTriageIds.size === 0 || collections.length === 0}
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
                    disabled={selectedTriageIds.size === 0}
                    onClick={() => void prepareTriageDeletion()}
                  >
                    🗑️ 移入回收站 ({selectedTriageIds.size})
                  </Button>
                </div>
              )}
            </header>

            {!hasSearched ? (
              <div className="studio-empty-hero">
                <div className="studio-empty-orb">
                  <span className="studio-empty-orb-icon">🧭</span>
                </div>
                <h3>配置参数并开启特征排查</h3>
                <p>
                  选择左侧的扫描范围与特征预设，点击“开始特征排查”即可快速检索目标画作。
                  <br />
                  检索基于本地离线视觉数据，安全且零网络开销，绝不更改您的原始图片。
                </p>
                <div className="studio-workflow-steps">
                  <div className="studio-step-node">
                    <span>1</span>
                    <em>选择范围</em>
                  </div>
                  <div className="studio-step-connector">⋯</div>
                  <div className="studio-step-node">
                    <span>2</span>
                    <em>选定特征</em>
                  </div>
                  <div className="studio-step-connector">⋯</div>
                  <div className="studio-step-node">
                    <span>3</span>
                    <em>批量归档 / 清理</em>
                  </div>
                </div>
              </div>
            ) : triageResults.length === 0 ? (
              <div className="studio-empty-hero">
                <div className="studio-empty-orb">
                  <span className="studio-empty-orb-icon">🍃</span>
                </div>
                <h3>未发现符合目标特征的画作</h3>
                <p>
                  当前检索范围内没有图片达到设定特征的 {Math.round(minConfidence * 100)}% 置信度。
                  <br />
                  可以适当调低灵敏度阈值重试，或先在「推荐相册分类」中为图库进行一次分析。
                </p>
              </div>
            ) : (
              <div className="studio-cards-grid">
                {triageResults.map((item) => {
                  const isChecked = selectedTriageIds.has(item.work.id);
                  const coverPath = item.work.coverAsset?.thumbnailPath ?? item.work.coverAsset?.path ?? "";
                  const imageUrl = coverPath ? `sanctuary-image://local/${encodeURIComponent(coverPath)}` : "";
                  const topTag = item.matchedTags[0];

                  return (
                    <article
                      key={item.work.id}
                      className={`studio-work-card ${isChecked ? "selected" : ""}`}
                      onClick={() => toggleSelectTriageItem(item.work.id)}
                    >
                      <div className="studio-card-media">
                        {imageUrl ? (
                          <img src={imageUrl} alt="" loading="lazy" />
                        ) : (
                          <div className="work-cover-missing">◇</div>
                        )}
                        {topTag && (
                          <span className="studio-card-top-badge">
                            {topTag.tag.replaceAll("_", " ")} {Math.round(topTag.confidence * 100)}%
                          </span>
                        )}
                        <button
                          type="button"
                          className="studio-card-checkbox"
                          aria-label={isChecked ? "取消勾选" : "勾选"}
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

                        <div className="studio-card-tags">
                          {item.matchedTags.map((mt) => (
                            <span key={mt.tag} className="studio-card-tag-pill">
                              {mt.tag.replaceAll("_", " ")} <em>{Math.round(mt.confidence * 100)}%</em>
                            </span>
                          ))}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : (
        /* =================== TAB 2: 分类打标建议 (模型流水线) =================== */
        <div className="studio-layout">
          {/* Left Column: Scope & Estimator Deck (Retains .analysis-scope-card) */}
          <section className="analysis-scope-card studio-control-deck">
            <div className="studio-deck-header">
              <div>
                <p className="eyebrow">PIPELINE DECK · 任务分发</p>
                <h2>选择要整理的范围</h2>
              </div>
              <span className="studio-safe-pill">模型按需启动</span>
            </div>

            <div className="studio-section-block">
              <span className="studio-block-label">1 · 分析范围</span>
              <div className="studio-scope-grid">
                {SCOPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={opt.disabled}
                    className={`studio-scope-btn ${scopeType === opt.id ? "active" : ""}`}
                    onClick={() => setScopeType(opt.id)}
                  >
                    <span className="studio-scope-icon">{opt.icon}</span>
                    <span className="studio-scope-texts">
                      <strong>{opt.label}</strong>
                      <small>{opt.hint}</small>
                    </span>
                  </button>
                ))}
              </div>

              {scopeType === "collection" && (
                <div className="studio-subselect-frame">
                  <span className="studio-subselect-icon">📁</span>
                  <select
                    className="studio-native-select"
                    value={collectionId}
                    onChange={(e) => setCollectionId(e.target.value)}
                  >
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {scopeType === "artist" && (
                <div className="studio-subselect-frame">
                  <span className="studio-subselect-icon">👤</span>
                  <select
                    className="studio-native-select"
                    value={artistId}
                    onChange={(e) => setArtistId(e.target.value)}
                  >
                    {artists.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="studio-deck-actions">
              <Button
                busy={busy}
                busyLabel="正在测算…"
                disabled={(scopeType === "selected" && !selectedWorkIds.length) || (scopeType === "artist" && !artistId) || (scopeType === "collection" && !collectionId)}
                onClick={() => void previewScope()}
                className="studio-preview-action-btn"
              >
                📊 测算任务工作量
              </Button>
            </div>

            {preview && (
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
                  disabled={preview.assetCount === 0}
                  onClick={() => void startJob()}
                  className="studio-launch-action-btn"
                >
                  🚀 启动分类整理流水线
                </Button>
              </div>
            )}
          </section>

          {/* Right Column: Job Center & Suggestions */}
          <section className="studio-stage-workbench">
            <header className="studio-workbench-header">
              <div className="studio-workbench-title-box">
                <div className="studio-workbench-heading-row">
                  <span className="studio-badge-indicator" />
                  <h2>任务中心与分类打标</h2>
                </div>
                <span className="studio-workbench-sub">
                  分析结果与下载信任完全分离；未勾选的建议仅留作特征记录。
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
                    在左侧选择画库范围并预览测算后，即可一键下发后台分析流水线。
                    <br />
                    所有任务不会在后台静默偷跑，完全透明可控。
                  </p>
                </div>
              ) : (
                jobs.map((job) => {
                  const progress = job.totalItems ? Math.round((job.processedItems / job.totalItems) * 100) : 100;
                  const chosen = selectedSuggestions[job.id] ?? [];
                  return (
                    <article className="studio-job-card" key={job.id}>
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
                            <p className="studio-no-suggestions">没有达到 55% 置信度的通用聚类标签建议。</p>
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
                                      <small>
                                        {suggestion.workIds.length} 个作品 · 平均 {Math.round(suggestion.averageConfidence * 100)}%
                                      </small>
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
        </div>
      )}

      {/* Work Deletion Dialog for Triage */}
      {deletionPreview && (
        <DialogOverlay busy={deletingWorks} onClose={() => setDeletionPreview(null)}>
          <section className="dialog-surface work-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="triage-delete-title">
            <p className="eyebrow">BATCH DELETE PREVIEW</p>
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
    </div>
  );
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
