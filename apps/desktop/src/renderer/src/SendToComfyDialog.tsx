import { useEffect, useState } from "react";
import type { ComfyWorkflowTemplateSummary } from "@sanctuary/domain";
import { DialogOverlay } from "./DialogOverlay";
import { Button } from "./Button";

/** Sends a creation reply to local ComfyUI as the prompt, with the conversation's first reference page as the source. */
export function SendToComfyDialog({ source, prompt, onClose, onQueued }: {
  source: { workId: string; pageIndex: number; title: string };
  prompt: string;
  onClose: () => void;
  onQueued: () => void;
}) {
  const [templates, setTemplates] = useState<ComfyWorkflowTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [positive, setPositive] = useState(prompt.trim().slice(0, 4000));
  const [negative, setNegative] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    void window.sanctuary.listComfyUiTemplates().then((items) => { setTemplates(items); setTemplateId(items[0]?.id ?? ""); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "读取工作流失败"));
  }, []);
  async function send() {
    if (busy || !templateId || !positive.trim()) return;
    setBusy(true); setError("");
    try {
      await window.sanctuary.startComfyUiJob({ workId: source.workId, pageIndex: source.pageIndex, templateId, positivePrompt: positive.trim(), negativePrompt: negative.trim() });
      onQueued(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发送到 ComfyUI 失败"); }
    finally { setBusy(false); }
  }
  return <DialogOverlay busy={busy} onClose={onClose}>
    <form className="dialog-surface send-to-comfy-dialog" role="dialog" aria-modal="true" aria-labelledby="send-to-comfy-title" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <h2 id="send-to-comfy-title">拿去出图</h2>
      <p>以“{source.title}”第 {source.pageIndex + 1} 页为参考，交给本机 ComfyUI。完成后结果会回到图库，并记下来源和提示词。</p>
      <label>工作流<select aria-label="ComfyUI 工作流" value={templateId} disabled={busy} onChange={(event) => setTemplateId(event.target.value)}>
        {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select></label>
      <label>正向提示词<textarea aria-label="正向提示词" rows={6} value={positive} maxLength={4000} disabled={busy} onChange={(event) => setPositive(event.target.value)} /></label>
      <label>负向提示词<textarea aria-label="负向提示词" rows={2} value={negative} maxLength={2000} disabled={busy} placeholder="可留空" onChange={(event) => setNegative(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <footer><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={!templateId || !positive.trim()} busy={busy} busyLabel="正在发送…">发送到 ComfyUI</Button></footer>
    </form>
  </DialogOverlay>;
}
