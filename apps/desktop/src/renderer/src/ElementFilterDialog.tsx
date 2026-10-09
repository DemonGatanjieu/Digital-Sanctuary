import { useEffect, useRef, useState } from "react";
import type { AnalysisJob, ElementIndexStatus, WorkElementFilter } from "@sanctuary/domain";
import { Button } from "./Button";
import { DialogOverlay } from "./DialogOverlay";
import { ELEMENT_OPTIONS, parseTagList } from "./element-filters";

type Condition = "include" | "exclude";

/** Element conditions for the gallery, plus the one place to tag the library so they can match. */
export function ElementFilterDialog({ value, onApply, onClose }: {
  value: WorkElementFilter | undefined;
  onApply: (filter: WorkElementFilter) => void;
  onClose: () => void;
}) {
  const [conditions, setConditions] = useState<Record<string, Condition>>(() => {
    const initial: Record<string, Condition> = {};
    for (const tag of value?.include ?? []) initial[tag] = "include";
    for (const tag of value?.exclude ?? []) initial[tag] = "exclude";
    return initial;
  });
  const known = new Set(ELEMENT_OPTIONS.map(([, tag]) => tag));
  const [extraInclude, setExtraInclude] = useState((value?.include ?? []).filter((tag) => !known.has(tag)).join(", "));
  const [extraExclude, setExtraExclude] = useState((value?.exclude ?? []).filter((tag) => !known.has(tag)).join(", "));
  const [blocked, setBlocked] = useState(Boolean(value?.blocked));

  function cycle(tag: string) {
    setConditions((current) => {
      const next = { ...current };
      if (!next[tag]) next[tag] = "include";
      else if (next[tag] === "include") next[tag] = "exclude";
      else delete next[tag];
      return next;
    });
  }
  function apply() {
    const preset = (kind: Condition) => Object.entries(conditions).filter(([tag, condition]) => condition === kind && known.has(tag)).map(([tag]) => tag);
    onApply({ include: [...preset("include"), ...parseTagList(extraInclude)], exclude: [...preset("exclude"), ...parseTagList(extraExclude)], blocked });
    onClose();
  }

  return <DialogOverlay onClose={onClose}>
    <form className="dialog-surface element-filter-dialog" role="dialog" aria-modal="true" aria-labelledby="element-filter-title" onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <h2 id="element-filter-title">按元素筛选</h2>
      <ElementIndexBar />
      <label className="element-filter-blocked"><input type="checkbox" checked={blocked} onChange={(event) => setBlocked(event.target.checked)} />只看含有我屏蔽元素的作品<small>使用探索里的屏蔽规则</small></label>
      <p className="element-filter-hint">点一下“需要”，再点一下“排除”，第三下取消。</p>
      <div className="element-filter-grid">
        {ELEMENT_OPTIONS.map(([label, tag]) => (
          <button key={tag} type="button" data-condition={conditions[tag] ?? "any"} aria-pressed={Boolean(conditions[tag])}
            aria-label={`${label}：${conditions[tag] === "include" ? "需要" : conditions[tag] === "exclude" ? "排除" : "不限"}`} onClick={() => cycle(tag)}>
            {label}{conditions[tag] && <small>{conditions[tag] === "include" ? "需要" : "排除"}</small>}
          </button>
        ))}
      </div>
      <details className="element-filter-more" open={Boolean(extraInclude || extraExclude)}>
        <summary>其他标签</summary>
        <label>需要<input aria-label="需要的其他标签" placeholder="英文标签，逗号分隔，如 red_eyes" value={extraInclude} onChange={(event) => setExtraInclude(event.target.value)} /></label>
        <label>排除<input aria-label="排除的其他标签" placeholder="英文标签，逗号分隔" value={extraExclude} onChange={(event) => setExtraExclude(event.target.value)} /></label>
      </details>
      <footer>
        <Button onClick={() => { setConditions({}); setExtraInclude(""); setExtraExclude(""); setBlocked(false); }}>清空</Button>
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" type="submit">应用</Button>
      </footer>
    </form>
  </DialogOverlay>;
}

/** How much of the library carries tags, and a way to tag the rest. Uses the library-wide analysis job. */
function ElementIndexBar() {
  const [status, setStatus] = useState<ElementIndexStatus | null>(null);
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true);
  async function refresh() {
    const [coverage, jobs] = await Promise.all([window.sanctuary.elementCoverage(), window.sanctuary.listAnalysisJobs()]);
    if (!alive.current) return;
    setStatus(coverage);
    setJob(jobs.find((item) => item.scope.type === "all" && (item.status === "queued" || item.status === "running")) ?? null);
  }
  useEffect(() => {
    alive.current = true;
    void refresh().catch((cause) => setError(message(cause)));
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!job) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 1000);
    return () => window.clearInterval(timer);
  }, [job?.id]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); await refresh(); } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  if (!status) return <p className="element-index-bar" role="status">正在读取识别进度…</p>;
  const missing = status.totalAssets - status.taggedAssets;
  return <div className="element-index-bar" role="status">
    {job ? <span>正在识别 · {job.processedItems} / {job.totalItems} 张</span>
      : <span>{missing > 0 ? `已识别 ${status.taggedAssets} / ${status.totalAssets} 张。未识别的图片不会出现在“排除”结果里。` : `全部 ${status.totalAssets} 张已识别`}</span>}
    {job ? <Button size="small" disabled={busy || job.cancelRequested} onClick={() => void run(() => window.sanctuary.cancelAnalysisJob(job.id))}>{job.cancelRequested ? "正在停止…" : "停止"}</Button>
      : missing > 0 && <Button size="small" busy={busy} onClick={() => void run(async () => {
        const created = await window.sanctuary.createAnalysisJob({ type: "all" });
        await window.sanctuary.startAnalysisJob(created.id);
      })}>识别其余 {missing} 张</Button>}
    {error && <span role="alert">{error}</span>}
  </div>;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : "操作失败，请重试";
}

