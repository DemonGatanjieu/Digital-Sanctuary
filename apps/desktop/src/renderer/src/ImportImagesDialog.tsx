import { useState } from "react";
import type { CollectionRecord, LocalImportBatch, LocalImportOptions } from "@sanctuary/domain";
import { Button } from "./Button";
import { DialogOverlay } from "./DialogOverlay";

const labels = { pending: "等待导入", imported: "已新增", existing: "已在图库", duplicate: "已复用相同图片", failed: "失败", cancelled: "未导入" };
export function ImportImagesDialog({ batch, collections, busy, error, onCommand, onClose }: {
  batch: LocalImportBatch; collections: CollectionRecord[]; busy: boolean; error: string;
  onCommand: (action: "start" | "cancel" | "retry", options?: LocalImportOptions) => Promise<void>; onClose: () => void;
}) {
  const [collectionId, setCollectionId] = useState(batch.collectionId ?? "");
  const [duplicatePolicy, setDuplicatePolicy] = useState<LocalImportOptions["duplicatePolicy"]>(batch.duplicatePolicy);
  const [showAll, setShowAll] = useState(false);
  const ready = batch.phase === "ready";
  const running = batch.phase === "running";
  const count = (status: string) => batch.items.filter((item) => item.status === status).length;
  const finished = batch.items.length - count("pending");
  return <DialogOverlay busy={busy} onClose={onClose}>
    <section className="dialog-surface import-images-dialog" role="dialog" aria-modal="true" aria-labelledby="import-images-title">
      <h2 id="import-images-title">{ready ? "导入到图库" : running ? "正在导入图片" : batch.phase === "cancelled" ? "导入已停止" : "导入结果"}</h2>
      {ready ? <>
        <p>已选择 {batch.items.length} 张图片。原文件保留在原处。</p>
        <label>加入相册<select aria-label="导入相册" value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
          <option value="">暂不归档</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
        </select></label>
        <details><summary>重复图片怎么处理</summary>
          <label><input type="radio" name="duplicate-policy" checked={duplicatePolicy === "reuse"} onChange={() => setDuplicatePolicy("reuse")} />复用相同图片（推荐）</label>
          <label><input type="radio" name="duplicate-policy" checked={duplicatePolicy === "separate"} onChange={() => setDuplicatePolicy("separate")} />不同路径的图片分别保留</label>
          <p className="muted">校验本次选择及已记录内容指纹的图片。同名但内容不同的图片会分别保留；同一路径不会重复加入。</p>
        </details>
      </> : <>
        <p role="status">已处理 {finished} / {batch.items.length} · 新增 {count("imported")} · 已存在 {count("existing") + count("duplicate")} · 失败 {count("failed")}{count("cancelled") > 0 && ` · 未导入 ${count("cancelled")}`}</p>
        <progress aria-label="图片导入进度" value={finished} max={batch.items.length} />
        {running && <p className="muted">可以继续浏览，导入会在后台完成。停止后保留已导入的图片。</p>}
      </>}
      <details open={count("failed") > 0}><summary>{ready ? "查看选中的图片" : "查看逐项结果"}</summary>
        <ul className="import-item-list">{(showAll ? batch.items : batch.items.slice(0, 40)).map((item) => <li key={item.id}>
          <span title={item.fileName}>{item.fileName}</span><span className={item.status === "failed" ? "import-item-error" : "muted"}>{item.error ?? labels[item.status]}</span>
        </li>)}</ul>
        {!showAll && batch.items.length > 40 && <Button size="small" onClick={() => setShowAll(true)}>查看全部 {batch.items.length} 项</Button>}
      </details>
      {error && <p role="alert" className="import-item-error">{error}</p>}
      <footer>
        <Button disabled={busy} onClick={onClose}>{running ? "继续浏览" : ready ? "取消" : "完成"}</Button>
        {ready && <Button variant="primary" busy={busy} data-import-action="start" onClick={() => void onCommand("start", { collectionId: collectionId || null, duplicatePolicy })}>开始导入</Button>}
        {running && <Button disabled={busy || batch.cancelRequested} onClick={() => void onCommand("cancel")}>{batch.cancelRequested ? "正在停止…" : "停止导入"}</Button>}
        {!ready && !running && count("failed") > 0 && <Button variant="primary" busy={busy} data-import-action="retry" onClick={() => void onCommand("retry")}>只重试失败项（{count("failed")}）</Button>}
      </footer>
    </section>
  </DialogOverlay>;
}
