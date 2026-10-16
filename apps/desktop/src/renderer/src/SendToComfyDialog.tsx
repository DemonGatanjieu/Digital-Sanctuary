import { useEffect, useMemo, useState } from "react";
import { extractPromptsFromReply, type ComfyWorkflowTemplateSummary } from "@sanctuary/domain";
import { DialogOverlay } from "./DialogOverlay";
import { Button } from "./Button";

/** Sends a creation reply to local ComfyUI as the prompt, with a reference page from the conversation as the source. */
export function SendToComfyDialog({ source, sources, prompt, onClose, onQueued }: {
  source: { workId: string; pageIndex: number; title: string };
  sources?: ReadonlyArray<{ workId: string; pageIndex: number; title: string }>;
  prompt: string;
  onClose: () => void;
  onQueued: () => void;
}) {
  const candidates = useMemo(() => (sources && sources.length > 0 ? sources : [source]), [source, sources]);
  const parsed = useMemo(() => extractPromptsFromReply(prompt), [prompt]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [templates, setTemplates] = useState<ComfyWorkflowTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [positive, setPositive] = useState(parsed.positive);
  const [negative, setNegative] = useState(parsed.negative);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const activeSource = candidates[sourceIndex] ?? source;
  useEffect(() => {
    void window.sanctuary.listComfyUiTemplates().then((items) => { setTemplates(items); setTemplateId(items[0]?.id ?? ""); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "读取工作流失败"));
  }, []);
  async function send() {
    if (busy || !templateId || !positive.trim()) return;
    setBusy(true); setError("");
    try {
      await window.sanctuary.startComfyUiJob({ workId: activeSource.workId, pageIndex: activeSource.pageIndex, templateId, positivePrompt: positive.trim(), negativePrompt: negative.trim() });
      onQueued(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发送到 ComfyUI 失败"); }
    finally { setBusy(false); }
  }
  return <DialogOverlay busy={busy} onClose={onClose}>
    <form className="dialog-surface send-to-comfy-dialog" role="dialog" aria-modal="true" aria-labelledby="send-to-comfy-title" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <h2 id="send-to-comfy-title">拿去出图</h2>
      <p>以“{activeSource.title}”第 {activeSource.pageIndex + 1} 页为参考，交给本机 ComfyUI。完成后结果会回到图库，并记下来源和提示词。</p>
      {candidates.length > 1 && (
        <label>参考图<select aria-label="ComfyUI 参考图" value={sourceIndex} disabled={busy} onChange={(event) => setSourceIndex(Number(event.target.value))}>
          {candidates.map((item, idx) => <option key={`${item.workId}:${item.pageIndex}`} value={idx}>图片 {idx + 1} · {item.title}（第 {item.pageIndex + 1} 页）</option>)}
        </select></label>
      )}
      <label>工作流<select aria-label="ComfyUI 工作流" value={templateId} disabled={busy} onChange={(event) => setTemplateId(event.target.value)}>
        {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select></label>
      <label>
        <span className="send-to-comfy-label-row">
          <span>正向提示词{parsed.extracted ? "（已自动拆分正负向）" : ""}</span>
          {parsed.extracted && <button type="button" className="send-to-comfy-restore" disabled={busy} onClick={() => { setPositive(prompt.trim().slice(0, 4000)); setNegative(""); }}>使用完整原文</button>}
        </span>
        <textarea aria-label="正向提示词" rows={6} value={positive} maxLength={4000} disabled={busy} onChange={(event) => setPositive(event.target.value)} />
      </label>
      <label>负向提示词<textarea aria-label="负向提示词" rows={2} value={negative} maxLength={2000} disabled={busy} placeholder="可留空" onChange={(event) => setNegative(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <footer><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={!templateId || !positive.trim()} busy={busy} busyLabel="正在发送…">发送到 ComfyUI</Button></footer>
    </form>
  </DialogOverlay>;
}

