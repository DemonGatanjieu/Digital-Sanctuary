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
  tags: string[];
  description: string;
}

const FEATURE_PRESETS: FeaturePreset[] = [
  {
    id: "sketch_mono",
    name: "单色与线稿草图",
    tags: ["monochrome", "sketch", "comic", "lineart"],
    description: "黑白草图、四格漫画、线稿及单色插画"
  },
  {
    id: "chibi",
    name: "Q版与四格",
    tags: ["chibi", "4koma", "sd_character"],
    description: "二头身、Q版角色及四格小品"
  },
  {
    id: "ai_3d",
    name: "3D与AI特征",
    tags: ["ai_generated", "3d", "blender", "miku_miku_dance"],
    description: "3D渲染模型、MMD及可识别的AI生成特征"
  },
  {
    id: "blood_guro",
    name: "血腥与断肢",
    tags: ["blood", "guro", "severed_head", "severed_limb", "corpse"],
    description: "出血、内脏、肢体残缺等可能不适的内容"
  }
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
  const [tab, setTab] = useState<StudioTab>("triage");

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
        setNotice("在当前已分析的画库中未匹配到符合条件的画作。若未进行过批量模型分析，可先在「分类打标建议」中运行分析任务。");
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

  return (
    <>
      <header className="topbar analysis-heading">
        <div>
          <p className="eyebrow">INTELLIGENT STUDIO & TRIAGE</p>
          <h1>智能工坊</h1>
          <p className="page-description">
            本地图片清洗排查与模型打标。完全由你主动触发，绝不自动篡改或隐藏已下载的画作。
          </p>
        </div>
        <div className="analysis-heading-right">
          <SegmentedControl
            label="工坊模式"
            value={tab}
            options={[
              { value: "triage", label: "🧹 智能清洗与排查", title: "按特征标签排查并批量处理图片" },
              { value: "suggestions", label: "📑 分类打标建议", title: "由模型自动为作品生成相册分类建议" }
            ]}
            onChange={(val) => setTab(val as StudioTab)}
          />
          <div className="analysis-engine-pill">
            <span>{status?.visionProvider ?? "检测中"}</span>
            <strong>{status?.visionEngine ?? "视觉引擎"}</strong>
          </div>
        </div>
      </header>

      {error && <AppNotice tone="error">{error}</AppNotice>}
      {notice && <AppNotice tone="success" onDismiss={() => setNotice("")}>{notice}</AppNotice>}

      {tab === "triage" ? (
        /* =================== TAB 1: 智能清洗与排查 =================== */
        <div className="triage-studio-container">
          <section className="analysis-scope-card triage-config-card">
            <header>
              <div>
                <p className="eyebrow">1 · SCAN SCOPE & TARGETS</p>
                <h2>配置排查范围与目标特征</h2>
              </div>
              <small>安全沙箱 · 仅检索已分析特征，不破坏原文件</small>
            </header>

            <div className="analysis-scope-options">
              <label>
                <input type="radio" checked={scopeType === "selected"} disabled={!selectedWorkIds.length} onChange={() => setScopeType("selected")} />
                <span><strong>画廊所选作品</strong><small>{selectedWorkIds.length ? `${selectedWorkIds.length} 个作品` : "先在画廊进入选择模式"}</small></span>
              </label>
              <label>
                <input type="radio" checked={scopeType === "collection"} disabled={!collections.length} onChange={() => setScopeType("collection")} />
                <span><strong>某个分类相册</strong><small>指定相册范围</small></span>
              </label>
              <label>
                <input type="radio" checked={scopeType === "artist"} disabled={!artists.length} onChange={() => setScopeType("artist")} />
                <span><strong>某位作者作品</strong><small>指定画师范围</small></span>
              </label>
              <label>
                <input type="radio" checked={scopeType === "all"} onChange={() => setScopeType("all")} />
                <span><strong>整个画库</strong><small>全部本地作品</small></span>
              </label>
            </div>

            {scopeType === "collection" && (
              <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {scopeType === "artist" && (
              <select value={artistId} onChange={(e) => setArtistId(e.target.value)}>
                {artists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}

            <div className="triage-features-section">
              <p className="sidebar-section-label">目标排查特征</p>
              <div className="triage-presets-grid">
                {FEATURE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`triage-preset-pill ${activePresetId === preset.id ? "active" : ""}`}
                    onClick={() => setActivePresetId(preset.id)}
                  >
                    <strong>{preset.name}</strong>
                    <small>{preset.description}</small>
                  </button>
                ))}
                <button
                  type="button"
                  className={`triage-preset-pill ${activePresetId === "custom" ? "active" : ""}`}
                  onClick={() => setActivePresetId("custom")}
                >
                  <strong>🔍 自定义标签检索</strong>
                  <small>输入任意 WD Tag 关键词</small>
                </button>
              </div>

              {activePresetId === "custom" && (
                <div className="triage-custom-input-row">
                  <input
                    type="text"
                    className="inspector-search-input"
                    placeholder="输入 Tag 英文名（多个用空格或逗号分隔，如 chibi, monochrome, 3d）"
                    value={customTagInput}
                    onChange={(e) => setCustomTagInput(e.target.value)}
                  />
                </div>
              )}

              <div className="triage-threshold-slider">
                <label>
                  <span>置信度阈值：{Math.round(minConfidence * 100)}%</span>
                  <input
                    type="range"
                    min="0.1"
                    max="0.9"
                    step="0.05"
                    value={minConfidence}
                    onChange={(e) => setMinConfidence(Number(e.target.value))}
                  />
                </label>
              </div>
            </div>

            <footer>
              <Button
                variant="primary"
                busy={searchingTriage}
                busyLabel="正在扫描排查..."
                onClick={() => void runTriageQuery()}
              >
                🔍 开始特征排查
              </Button>
              <Button
                variant="ghost"
                title="将当前选择的目标特征同步加入全局探索拦截规则"
                onClick={() => void addTriageTagsToBlacklist()}
              >
                🚫 将此特征加入探索拦截黑名单
              </Button>
            </footer>
          </section>

          {/* Triage Results & Batch Actions */}
          <section className="triage-results-section">
            <header className="triage-results-header">
              <div>
                <p className="eyebrow">2 · TRIAGE WORKBENCH</p>
                <h2>排查结果与批处理 ({triageResults.length})</h2>
              </div>

              {triageResults.length > 0 && (
                <div className="triage-batch-actions">
                  <Button size="small" variant="ghost" onClick={selectAllTriage}>
                    {selectedTriageIds.size === triageResults.length ? "取消全选" : `全选 (${triageResults.length})`}
                  </Button>

                  <select
                    className="triage-assign-select"
                    value=""
                    disabled={selectedTriageIds.size === 0 || collections.length === 0}
                    onChange={(e) => void assignTriageToCollection(e.target.value)}
                  >
                    <option value="">📁 批量归档至相册…</option>
                    {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>

                  <Button
                    size="small"
                    variant="danger-soft"
                    disabled={selectedTriageIds.size === 0}
                    onClick={() => void prepareTriageDeletion()}
                  >
                    🗑️ 批量移入回收站 ({selectedTriageIds.size})
                  </Button>
                </div>
              )}
            </header>

            {!hasSearched ? (
              <div className="analysis-empty">
                <strong>点击上方“开始特征排查”即可检索符合特征的作品</strong>
                <span>排查基于本地模型的视觉分析数据；未进行过分析的作品可在“分类打标建议”中先跑一次任务。</span>
              </div>
            ) : triageResults.length === 0 ? (
              <div className="analysis-empty">
                <strong>未检测到符合目标特征的画作</strong>
                <span>当前范围内没有图片命中该特征或置信度未达标。</span>
              </div>
            ) : (
              <div className="triage-cards-grid">
                {triageResults.map((item) => {
                  const isChecked = selectedTriageIds.has(item.work.id);
                  const coverPath = item.work.coverAsset?.thumbnailPath ?? item.work.coverAsset?.path ?? "";
                  const imageUrl = coverPath ? `sanctuary-image://local/${encodeURIComponent(coverPath)}` : "";
                  return (
                    <article
                      key={item.work.id}
                      className={`triage-work-card ${isChecked ? "selected" : ""}`}
                      onClick={() => toggleSelectTriageItem(item.work.id)}
                    >
                      <div className="triage-card-preview">
                        {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <div className="work-cover-missing">◇</div>}
                        <button
                          type="button"
                          className="triage-checkbox"
                          aria-label={isChecked ? "取消勾选" : "勾选"}
                          onClick={(e) => { e.stopPropagation(); toggleSelectTriageItem(item.work.id); }}
                        >
                          {isChecked ? "✓" : ""}
                        </button>
                      </div>

                      <div className="triage-card-info">
                        <strong title={item.work.title}>{item.work.title}</strong>
                        <small title={item.work.artistName ?? ""}>{item.work.artistName ?? "本地作品"}</small>

                        <div className="triage-card-tags">
                          {item.matchedTags.map((mt) => (
                            <span key={mt.tag} className="triage-tag-badge">
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
        /* =================== TAB 2: 分类打标建议 (现有完整逻辑) =================== */
        <>
          <section className="analysis-scope-card">
            <header><div><p className="eyebrow">1 · CHOOSE SCOPE</p><h2>选择要整理的范围</h2></div><small>进入此页面不会启动模型</small></header>
            <div className="analysis-scope-options">
              <label><input type="radio" checked={scopeType === "selected"} disabled={!selectedWorkIds.length} onChange={() => setScopeType("selected")} /><span><strong>画廊所选作品</strong><small>{selectedWorkIds.length ? `${selectedWorkIds.length} 个作品` : "先在画廊进入选择模式"}</small></span></label>
              <label><input type="radio" checked={scopeType === "collection"} disabled={!collections.length} onChange={() => setScopeType("collection")} /><span><strong>某个分类</strong><small>分析分类里的全部图片页</small></span></label>
              <label><input type="radio" checked={scopeType === "artist"} disabled={!artists.length} onChange={() => setScopeType("artist")} /><span><strong>某位作者</strong><small>按作者作品范围运行</small></span></label>
              <label><input type="radio" checked={scopeType === "all"} onChange={() => setScopeType("all")} /><span><strong>整个画廊</strong><small>大图库建议先从小范围试跑</small></span></label>
            </div>
            {scopeType === "collection" && <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select>}
            {scopeType === "artist" && <select value={artistId} onChange={(event) => setArtistId(event.target.value)}>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select>}
            <footer><Button busy={busy} busyLabel="正在计算…" disabled={(scopeType === "selected" && !selectedWorkIds.length) || (scopeType === "artist" && !artistId) || (scopeType === "collection" && !collectionId)} onClick={() => void previewScope()}>预览任务范围</Button></footer>
          </section>

          {preview && (
            <section className="analysis-preview-card">
              <div><span>作品</span><strong>{preview.workCount}</strong></div>
              <div><span>图片页</span><strong>{preview.assetCount}</strong></div>
              <div><span>可复用结果</span><strong>{preview.cachedAssetCount}</strong></div>
              <div><span>需要新推理</span><strong>{Math.max(0, preview.assetCount - preview.cachedAssetCount)}</strong></div>
              <p>{preview.assetCount === 0 ? "这个范围没有可用的本地图片。" : "点击开始后任务才会调用模型；可以随时请求取消，当前正在分析的一张会结束后停止。"}</p>
              <Button variant="primary" busy={busy} busyLabel="正在创建…" disabled={preview.assetCount === 0} onClick={() => void startJob()}>明确开始整理</Button>
            </section>
          )}

          <div className="settings-section-heading"><p className="eyebrow">2 · JOB CENTER</p><h2>任务与建议</h2><span>分析结果与下载信任完全分离；失败项不会被当作安全或命中。</span></div>
          <section className="analysis-job-list">
            {jobs.length === 0 && <div className="analysis-empty"><strong>还没有整理任务</strong><span>先选择一个小范围预览，不会在后台偷偷运行。</span></div>}
            {jobs.map((job) => {
              const progress = job.totalItems ? Math.round(job.processedItems / job.totalItems * 100) : 100;
              const chosen = selectedSuggestions[job.id] ?? [];
              return (
                <article className="analysis-job-card" key={job.id}>
                  <header><div><span className={`analysis-status ${job.status}`}>{statusLabel(job.status)}</span><strong>{scopeLabel(job.scope, collections, artists)}</strong><small>{job.engine} · {new Date(job.createdAt).toLocaleString("zh-CN")}</small></div>{(job.status === "queued" || job.status === "running") && <Button size="small" variant="danger-soft" onClick={() => void window.sanctuary.cancelAnalysisJob(job.id).then(refreshJobs).catch(onError)}>取消任务</Button>}</header>
                  <div className="analysis-progress"><span style={{ width: `${progress}%` }} /></div>
                  <div className="analysis-job-metrics"><span>{job.processedItems} / {job.totalItems} 图片</span><span>{job.cacheHits} 次缓存</span><span>{job.failedItems} 个失败</span></div>
                  {job.error && <AppNotice tone="error">{job.error}</AppNotice>}
                  {job.status === "completed" && (
                    <div className="analysis-suggestions">
                      <div><strong>分类建议</strong><small>勾选后点击确认；未勾选的结果只留作分析记录。</small></div>
                      {job.suggestions.length === 0 ? <p>没有达到 55% 置信度的通用标签建议。</p> : job.suggestions.map((suggestion) => (
                        <label key={suggestion.id}>
                          <input type="checkbox" checked={chosen.includes(suggestion.id)} onChange={(event) => setSelectedSuggestions((current) => ({ ...current, [job.id]: event.target.checked ? [...chosen, suggestion.id] : chosen.filter((id) => id !== suggestion.id) }))} />
                          <span><strong>{suggestion.label.replaceAll("_", " ")}</strong><small>{suggestion.workIds.length} 个作品 · 平均 {Math.round(suggestion.averageConfidence * 100)}%</small></span>
                        </label>
                      ))}
                      {job.suggestions.length > 0 && <Button variant="primary" disabled={!chosen.length || busy} onClick={() => void applySuggestions(job)}>确认所选建议并建立分类</Button>}
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        </>
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
    </>
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
