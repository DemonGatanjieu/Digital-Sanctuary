import { useState } from "react";
import type { AnalysisTaskSummary, LocalImportBatch, ImageTaskSummary } from "@sanctuary/domain";
import type { ExploreDownloadState } from "../../shared/pixiv-download";
import { analysisTaskLabel, importTaskCounts, type ThumbnailActivity } from "./task-center-model";
import { downloadPhaseLabel } from "./ExploreView";
import { Button } from "./Button";
import { DialogOverlay } from "./DialogOverlay";

export function TaskCenter({ batch, download, thumbnails, jobs, images=[], loading, error, onRefresh, onImport, onExplore, onOrganize, onImageTask, onOpenStorage, onRetryThumbnails, onClose }: {
  batch: LocalImportBatch | null; download: ExploreDownloadState; thumbnails: ThumbnailActivity; jobs: AnalysisTaskSummary[];
  loading: boolean; error: string; onRefresh: () => void; onImport: () => void; onExplore: () => void; onOrganize: (jobId: string) => void;
  onOpenStorage: () => Promise<unknown>; onRetryThumbnails: () => void; onClose: () => void;
  images?: ImageTaskSummary[]; onImageTask?: (source: "library"|"folder")=>void;
}) {
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  async function analysisAction(job: AnalysisTaskSummary, cancel = false) {
    if (busy) return;
    setBusy(job.id); setActionError("");
    try { if (cancel) await window.sanctuary.cancelAnalysisJob(job.id); else await window.sanctuary.startAnalysisJob(job.id); onRefresh(); }
    catch (cause) { setActionError(cause instanceof Error && /[\u4e00-\u9fff]/.test(cause.message) ? cause.message : "这项任务暂时不能操作，请重新读取状态后重试"); }
    finally { setBusy(""); }
  }
  const importCounts = batch ? importTaskCounts(batch) : null;
  const sortedJobs = [...jobs].sort((a, b) => Number(b.status === "running" || b.status === "queued") - Number(a.status === "running" || a.status === "queued") || b.createdAt.localeCompare(a.createdAt));
  const hasThumbnailTask = thumbnails.phase !== "idle" && (thumbnails.phase !== "completed" || thumbnails.generated + thumbnails.reused + thumbnails.failed > 0 || thumbnails.limited);
  const empty = !batch && download.phase === "idle" && !hasThumbnailTask && !jobs.length && !images.length && !loading;
  return <DialogOverlay busy={Boolean(busy)} onClose={onClose}>
    <section className="dialog-surface task-center-dialog" role="dialog" aria-modal="true" aria-labelledby="task-center-title">
      <header><h2 id="task-center-title">任务与进度</h2><Button disabled={Boolean(busy)} size="small" onClick={onClose}>继续浏览</Button></header>
      <p className="muted">这里汇总导入、下载、补图、找图分析与原图复制。关闭此页，进行中的任务会继续。</p>
      {(error || actionError) && <p role="alert">{actionError || error}<Button size="small" disabled={Boolean(busy)} onClick={onRefresh}>重新读取</Button></p>}
      {empty && <p>暂无任务。导入图片、保存作品或在整理台开始识别后，可在这里查看进度。</p>}
      <div className="task-center-list">
        {images.map(task=><article key={task.id} data-task-kind={task.kind}><header><strong>{task.kind==="copy"?"原图复制":task.source==="folder"?`文件夹找图 · ${task.name}`:"图库找图"}</strong><span>{task.cancelRequested&&["running","scanning","analyzing"].includes(task.phase)?"正在停止":task.phase==="scanning"?"扫描中":task.phase==="analyzing"||task.phase==="running"?"处理中":task.phase==="ready"?"待分析":task.phase==="cancelled"?"已停止":task.phase==="failed"?"任务失败":task.failed?task.failed===task.total?"未完成":"部分完成":"已完成"}</span></header>
          <p>已处理 {task.processed} / {task.total} 张 · 失败 {task.failed}</p><div className="task-center-actions">
            {onImageTask&&<Button size="small" disabled={Boolean(busy)} onClick={()=>onImageTask(task.source)}>返回找图与取用</Button>}
            {["scanning","analyzing","running"].includes(task.phase)&&<Button size="small" disabled={Boolean(busy)||task.cancelRequested} onClick={async()=>{if(busy)return;setBusy(task.id);setActionError("");try{if(task.kind==="copy")await window.sanctuary.cancelImageExport(task.id);else await window.sanctuary.cancelWorkbench(task.id);onRefresh();}catch{setActionError("停止失败，请重新读取或返回找图页面重试");}finally{setBusy("");}}}>停止任务</Button>}
          </div></article>)}
        {batch && importCounts && <article data-task-kind="import"><header><strong>本地图片导入</strong><span>{batch.phase === "ready" ? "待确认" : batch.phase === "running" ? batch.cancelRequested ? "正在停止" : "导入中" : batch.phase === "cancelled" ? "已停止" : importCounts.failed ? importCounts.imported + importCounts.existing > 0 ? "部分完成" : "导入失败" : "已完成"}</span></header>
          <p>已处理 {importCounts.processed} / {batch.items.length} · 新增 {importCounts.imported} · 已存在 {importCounts.existing} · 失败 {importCounts.failed}{importCounts.cancelled > 0 && ` · 未导入 ${importCounts.cancelled}`}</p>
          <Button size="small" disabled={Boolean(busy)} onClick={onImport}>{batch.phase === "ready" ? "继续确认" : importCounts.failed ? "查看结果与重试" : "查看导入详情"}</Button></article>}
        {download.phase !== "idle" && <article data-task-kind="download"><header><strong>{download.scope === "bookmarks" ? "收藏作品下载" : "作品下载"}</strong><span>{downloadPhaseLabel(download.phase)}</span></header>
          <p>已处理 {download.completedArtworks + download.failedArtworks} / {download.totalArtworks} 件 · 成功 {download.completedArtworks} · 失败 {download.failedArtworks}</p>
          <p>{download.message}</p>{download.lastFailure && <details><summary>失败原因</summary><p>{download.lastFailure}</p></details>}
          <div className="task-center-actions"><Button size="small" disabled={Boolean(busy)} onClick={onExplore}>查看探索</Button><Button size="small" disabled={Boolean(busy)} onClick={() => void onOpenStorage().catch(() => setActionError("无法打开保存位置，请到图库与存储设置检查"))}>打开保存位置</Button></div></article>}
        {hasThumbnailTask && <article data-task-kind="thumbnails"><header><strong>自动补全缩略图</strong><span>{thumbnails.phase === "running" ? "补图中" : thumbnails.phase === "failed" ? "未完成" : thumbnails.phase === "partial" ? "部分完成" : "本轮结束"}</span></header>
          <p>本轮生成 {thumbnails.generated} · 复用 {thumbnails.reused} · 失败 {thumbnails.failed}</p><p>{thumbnails.message}</p>
          {thumbnails.phase !== "running" && (thumbnails.failed > 0 || thumbnails.limited || thumbnails.phase === "failed") && <Button size="small" disabled={Boolean(busy)} onClick={onRetryThumbnails}>{thumbnails.limited && !thumbnails.failed ? "继续补图" : "重新尝试补图"}</Button>}</article>}
        {loading && <p role="status">正在读取识别任务…</p>}
        {sortedJobs.map((job) => <article key={job.id} data-task-kind="analysis" data-task-id={job.id}><header><strong>批量识别与分类建议</strong><span>{analysisTaskLabel(job)}</span></header>
          <p>{job.workCount} 件作品 · 已处理 {job.processedItems} / {job.totalItems} 页 · 失败 {job.failedItems}</p>
          {job.error && <details><summary>失败原因</summary><p>{job.error}</p></details>}
          <div className="task-center-actions">
            {job.status === "queued" && <Button size="small" disabled={Boolean(busy)} busy={busy === job.id} onClick={() => void analysisAction(job)}>开始任务</Button>}
            {(job.status === "queued" || job.status === "running") && <Button size="small" disabled={Boolean(busy) || job.cancelRequested} onClick={() => void analysisAction(job, true)}>{job.cancelRequested ? "正在停止…" : "停止任务"}</Button>}
            <Button size="small" disabled={Boolean(busy)} onClick={() => onOrganize(job.id)}>到整理台查看</Button>
          </div><details><summary>任务记录</summary><p>模型：{job.engine} · 创建于 {new Date(job.createdAt).toLocaleString("zh-CN")}</p></details>
        </article>)}
      </div>
    </section>
  </DialogOverlay>;
}
