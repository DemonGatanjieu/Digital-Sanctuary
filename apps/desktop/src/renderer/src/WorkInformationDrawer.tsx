import { useEffect, useRef, useState } from "react";
import type { WorkInformation, WorkRecord } from "@sanctuary/domain";
import { Button } from "./Button";
import { DialogOverlay } from "./DialogOverlay";
import { ExportImagesButton, SingleImageActions } from "./ImageOutputActions";

export function WorkInformationDrawer({ workId, pageIndex, onClose, onInspector, onRadar, onInspiration, onChanged, onRenamed }: {
  workId: string; pageIndex: number; onClose: () => void;
  onInspector: () => void; onRadar: () => void; onInspiration: () => void;
  onChanged: () => Promise<void> | void;
  onRenamed?: (work: WorkRecord) => void;
}) {
  const [information, setInformation] = useState<WorkInformation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [album, setAlbum] = useState("");
  const [revision, setRevision] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const generation = useRef(0);
  useEffect(() => { if (editingName) { nameInput.current?.focus(); nameInput.current?.select(); } }, [editingName]);
  useEffect(() => {
    const request = ++generation.current;
    setLoading(true); setInformation(null); setError(""); setAlbum("");
    setBusy(false); setEditingName(false); setNotice(""); composing.current = false;
    void window.sanctuary.getWorkInformation(workId, pageIndex).then((value) => {
      if (generation.current === request) { setInformation(value); if (!value) setError("这件作品已从图库移除"); }
    }).catch((cause) => { if (generation.current === request) setError(cause instanceof Error ? cause.message : "读取作品信息失败，请重试"); })
      .finally(() => { if (generation.current === request) setLoading(false); });
    return () => { generation.current += 1; };
  }, [workId, pageIndex, revision]);

  async function rename() {
    if (busy || composing.current || !name.trim()) return;
    const request = generation.current;
    let saved = false;
    setBusy(true); setError(""); setNotice("");
    try {
      const work = await window.sanctuary.renameWork(workId, name);
      saved = true;
      if (request === generation.current) {
        setInformation((current) => current ? { ...current, work } : null);
        setEditingName(false); setNotice("图库名称已保存"); onRenamed?.(work);
      }
      await onChanged();
    } catch (cause) {
      if (request === generation.current) setError(saved ? "名称已保存，但图库刷新失败，请重新读取。" : cause instanceof Error ? cause.message : "保存名称失败，请重试");
    } finally { if (request === generation.current) setBusy(false); }
  }

  async function membership(collectionId: string, remove = false) {
    if (busy) return;
    const request = generation.current;
    setBusy(true); setError("");
    try {
      const work = remove ? await window.sanctuary.removeWorkFromCollection(workId, collectionId)
        : await window.sanctuary.addWorkToCollection(workId, collectionId);
      if (!work) throw new Error("作品已不存在，请关闭信息页后刷新图库");
      if (request === generation.current) { setInformation((current) => current ? { ...current, work } : null); setAlbum(""); }
      await onChanged();
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : "归档失败，请重试"); }
    finally { if (request === generation.current) setBusy(false); }
  }
  const work = information?.work;
  const asset = work?.assets.find((item) => item.pageIndex === pageIndex);
  const tags = Object.entries(information?.assessment?.labels ?? {}).filter(([, confidence]) => confidence >= 0.2)
    .sort((a, b) => b[1] - a[1]).slice(0, 12);
  return <DialogOverlay busy={busy} onClose={onClose}>
    <section className="dialog-surface work-information-drawer" role="dialog" aria-modal="true" aria-labelledby="work-information-title">
      <header><h2 id="work-information-title">作品信息</h2><Button size="small" disabled={busy} onClick={onClose} aria-label="关闭作品信息">关闭</Button></header>
      {loading && <p role="status">正在读取作品信息…</p>}
      {error && <p role="alert">{error}<Button size="small" disabled={busy} onClick={() => setRevision((value) => value + 1)}>重新读取</Button></p>}
      {work && <>
        <div><div className="work-information-name-heading"><h3>{work.title}</h3>
          {!editingName && <Button size="small" variant="ghost" disabled={busy} onClick={() => { setName(work.title); setEditingName(true); setNotice(""); }}>修改图库名称</Button>}</div>
          {editingName && <form className="work-information-name" onSubmit={(event) => { event.preventDefault(); void rename(); }}>
            <label>图库名称<input ref={nameInput} aria-label="图库名称" maxLength={200} value={name} disabled={busy}
              onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
              onChange={(event) => setName(event.target.value)} /></label>
            <small className="muted">仅修改图库中的显示名称。{work.pageCount > 1 && "这件作品的所有页共用此名称。"}</small>
            <div className="work-information-actions"><Button size="small" type="submit" variant="primary" busy={busy} disabled={!name.trim()}>保存名称</Button>
              <Button size="small" disabled={busy} onClick={() => setEditingName(false)}>取消</Button></div>
          </form>}
          <p className="muted">{work.artistName ?? "本地作品"} · 第 {pageIndex + 1} 页 / {work.pageCount} 页</p>
          {notice && <p role="status">{notice}</p>}
        </div>
        <dl>
          <dt>来源</dt><dd>{work.sourcePlatform === "pixiv" ? `Pixiv · ${work.sourceWorkId}` : information?.provenance ? "本地生成" : "本地导入"}</dd>
          <dt>保存方式</dt><dd>{work.ownership === "managed" ? "应用保存的文件" : "外部文件，保留在原位置"}</dd>
          <dt>加入图库</dt><dd>{new Date(work.savedAt).toLocaleDateString("zh-CN")}</dd>
          <dt>当前文件</dt><dd>{asset?.path.split(/[\\/]/).at(-1) ?? "未记录"}</dd>
          <dt>尺寸与大小</dt><dd>{asset?.width && asset.height ? `${asset.width} × ${asset.height}` : "尺寸待读取"} · {formatInformationBytes(asset?.byteLength ?? null)}</dd>
          <dt>文件状态</dt><dd>{asset?.fileState === "available" ? "可读取" : asset?.fileState === "missing" ? "文件缺失" : "未记录"}</dd>
        </dl>
        <section aria-label="取用图片"><h3>拿出去使用</h3>
          {asset&&<SingleImageActions target={{workId,assetId:asset.id}} disabled={busy} />}
          <ExportImagesButton targets={[{workId}]} label={`复制整件作品原图（${work.pageCount} 页）`} disabled={busy} />
          <small className="muted">原图复制保留文件名，同名自动另存。剪贴板图片用于粘贴，超大图可能缩小。</small>
        </section>
        <section aria-label="作品相册"><h3>相册</h3>
          {work.collectionIds.length ? <ul className="work-information-albums">{work.collectionIds.map((id) => <li key={id}>
            <span>{information?.collections.find((item) => item.id === id)?.name ?? "相册已移除"}</span>
            <Button size="small" variant="ghost" disabled={busy} onClick={() => void membership(id, true)}>移出相册</Button>
          </li>)}</ul> : <p className="muted">还未加入相册</p>}
          <div className="work-information-assign"><select aria-label="作品信息相册" value={album} disabled={busy} onChange={(event) => setAlbum(event.target.value)}>
            <option value="">选择相册</option>{information?.collections.filter((item) => !work.collectionIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select><Button size="small" disabled={!album} busy={busy} onClick={() => void membership(album)}>加入相册</Button></div>
          <small className="muted">归档整件作品及其所有页，不移动原文件。</small>
        </section>
        <section><h3>已有识别与画评</h3>
          <p className="muted">{information?.assessment?.status === "complete" ? "本页已有标签识别记录" : information?.assessment ? "上次标签识别未成功，可重新识别" : "这页还没有保存的标签识别"}</p>
          {information?.assessment && <details><summary>查看已存标签与识别模型</summary><p>{information.assessment.engine} · 版本 {information.assessment.engineVersion}（保存时的模型）</p>
            <p className="work-information-tags">{tags.map(([name, confidence]) => <span key={name}>{name} {Math.round(confidence * 100)}%</span>)}</p></details>}
          <p className="muted">已有 {information?.evaluations.length ?? 0} 项画像 / 画评，查看详情或重新分析由你决定。</p>
          <div className="work-information-actions"><Button size="small" onClick={onInspector}>元素与提示词</Button><Button size="small" onClick={onRadar}>查看画像与画评</Button><Button size="small" onClick={onInspiration}>携图创作</Button></div>
        </section>
        {information?.provenance && <details><summary>生成来源与提示词</summary><p>工作流：{information.provenance.templateName}</p><p>来源作品：{information.provenance.sourceWorkId}</p><p>正向：{information.provenance.positivePrompt || "（空）"}</p><p>负向：{information.provenance.negativePrompt || "（空）"}</p></details>}
        <details><summary>文件与记录详情</summary><p>{asset?.path ?? "没有文件路径"}</p><p>格式：{asset?.extension ?? "未知"}</p><p>作品 ID：{work.id}</p></details>
      </>}
    </section>
  </DialogOverlay>;
}

export function formatInformationBytes(bytes: number | null): string {
  if (bytes === null) return "大小未记录";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
