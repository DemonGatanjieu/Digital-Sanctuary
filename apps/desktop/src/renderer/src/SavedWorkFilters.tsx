import { useEffect, useState } from "react";
import type { CollectionRecord, SavedWorkFilter, SavedWorkFilterQuery, WorkQuery } from "@sanctuary/domain";
import { savedFilterQuery } from "../../shared/saved-work-filter";
import { Button } from "./Button";
import { DialogOverlay } from "./DialogOverlay";

export function SavedWorkFilters({ query, collections, onApply }: { query: WorkQuery; collections: CollectionRecord[]; onApply: (query: WorkQuery) => void }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedWorkFilter[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void window.sanctuary.listSavedWorkFilters().then((items) => { if (active) { setSaved(items); setError(""); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "读取筛选失败，请重试"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  async function save() {
    if (busy || !name.trim()) return;
    setBusy(true); setError("");
    try { const entry = await window.sanctuary.createSavedWorkFilter({ name, query: savedFilterQuery(query) }); setSaved((items) => [...items, entry]); setName(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请重试"); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (busy) return;
    setBusy(true); setError("");
    try { await window.sanctuary.deleteSavedWorkFilter(id); setSaved((items) => items.filter((item) => item.id !== id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败，请重试"); }
    finally { setBusy(false); }
  }
  return <>
    <Button size="small" variant="ghost" data-saved-filters="open" onClick={() => setOpen(true)}>保存 / 恢复筛选{saved.length ? `（${saved.length}）` : ""}</Button>
    {open && <DialogOverlay busy={busy} onClose={() => setOpen(false)}>
      <section className="dialog-surface saved-work-filters-dialog" role="dialog" aria-modal="true" aria-labelledby="saved-work-filters-title">
        <header><h2 id="saved-work-filters-title">常用筛选</h2><Button disabled={busy} size="small" onClick={() => setOpen(false)}>关闭</Button></header>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <h3>保存当前条件</h3><p>{describeWorkFilter(savedFilterQuery(query), collections)}</p>
          <label>筛选名称<input aria-label="筛选名称" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：喜欢的背景参考" /></label>
          <Button type="submit" variant="primary" size="small" disabled={!name.trim() || loading || saved.length >= 30} busy={busy}>保存筛选</Button>
        </form>
        {error && <p role="alert">{error}<Button disabled={busy} size="small" onClick={() => setRevision((value) => value + 1)}>重新读取</Button></p>}
        <p className="muted">筛选保存条件和排序，结果随图库更新。最多 30 个，不复制或移动作品。</p>
        {loading ? <p role="status">正在读取…</p> : saved.length === 0 ? <p>还没有保存的筛选。为上面的当前条件起个名字即可。</p> :
          <ul className="saved-work-filter-list">{saved.map((entry) => <li key={entry.id}>
            <div><strong>{entry.name}</strong><p>{describeWorkFilter(entry.query, collections)}</p></div>
            <div className="saved-work-filter-actions"><Button size="small" disabled={busy} data-filter-apply={entry.id} onClick={() => { onApply({ ...entry.query, offset: 0, limit: query.limit ?? 60 }); setOpen(false); }}>使用</Button>
              <Button size="small" variant="ghost" disabled={busy} aria-label={`删除筛选 ${entry.name}`} onClick={() => void remove(entry.id)}>删除</Button></div>
          </li>)}</ul>}
      </section>
    </DialogOverlay>}
  </>;
}

export function describeWorkFilter(query: SavedWorkFilterQuery, collections: Pick<CollectionRecord, "id" | "name">[]): string {
  const parts: string[] = [];
  const album = (id: string) => collections.find((item) => item.id === id)?.name ?? "已移除的相册（保留原条件）";
  if (query.search) parts.push(`搜索“${query.search}”`);
  if (query.workType) parts.push(({ illustration: "插画", manga: "漫画", ugoira: "动图", local: "本地导入", unknown: "待补充类型" })[query.workType]);
  if (query.favorite !== undefined) parts.push(query.favorite ? "喜欢的作品" : "未标喜欢");
  if (query.uncollected) parts.push("未分相册");
  if (query.viewedOnly) parts.push("已浏览");
  if (query.artistId) parts.push("指定画师");
  if (query.unattributed !== undefined) parts.push(query.unattributed ? "未记录画师" : "已记录画师");
  if (query.collectionId) parts.push(`相册：${album(query.collectionId)}`);
  if (query.collectionIds?.length) parts.push(`${query.collectionMatchMode === "all" ? "同时属于" : "属于任一"}：${query.collectionIds.map(album).join("、")}`);
  if (query.excludedCollectionIds?.length) parts.push(`排除：${query.excludedCollectionIds.map(album).join("、")}`);
  if (!parts.length) parts.push("全部作品");
  const sort = ({ savedAt: "保存时间", lastViewedAt: "浏览时间", publishedAt: "发布时间", title: "标题", artist: "画师", pageCount: "页数", byteLength: "文件大小" })[query.sortBy ?? "savedAt"];
  parts.push(`${sort}${query.direction === "asc" ? "升序" : "降序"}`);
  return parts.join(" · ");
}
