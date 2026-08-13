import { useEffect, useMemo, useState } from "react";
import type {
  AnalysisJob,
  AnalysisScope,
  AnalysisScopePreview,
  ArtistRecord,
  CollectionRecord
} from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import type { AppStatus } from "./AppSidebar";
import { Button } from "./Button";

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
  const [scopeType, setScopeType] = useState<AnalysisScope["type"]>(selectedWorkIds.length ? "selected" : "all");
  const [artistId, setArtistId] = useState(artists[0]?.id ?? "");
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const [preview, setPreview] = useState<AnalysisScopePreview | null>(null);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, string[]>>({});
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
    } catch (error) {
      onError(error);
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
    } catch (error) {
      onError(error);
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
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar analysis-heading">
        <div><p className="eyebrow">EXPLICIT MODEL ORGANIZATION</p><h1>模型整理</h1><p className="page-description">由你选择范围并开始。结果先成为可解释的建议，确认后才会建立分类。</p></div>
        <div className="analysis-engine-pill"><span>{status?.visionProvider ?? "检测中"}</span><strong>{status?.visionEngine ?? "视觉引擎"}</strong></div>
      </header>
      {error && <AppNotice tone="error">{error}</AppNotice>}
      {notice && <AppNotice tone="success" onDismiss={() => setNotice("")}>{notice}</AppNotice>}

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
