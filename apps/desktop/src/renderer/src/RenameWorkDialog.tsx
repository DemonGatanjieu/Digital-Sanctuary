import { useEffect, useRef, useState } from "react";
import { DialogOverlay } from "./DialogOverlay";
import { Button } from "./Button";

export function RenameWorkDialog({ work, onClose, onSaved }: {
  work: { id: string; title: string }; onClose: () => void; onSaved: (title: string) => Promise<void>;
}) {
  const [name, setName] = useState(work.title), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null), composing = useRef(false), pending = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  async function save() {
    if (pending.current || composing.current || !name.trim()) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const renamed = await window.sanctuary.renameWork(work.id, name);
      await onSaved(renamed.title);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "改名失败，请重试"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <DialogOverlay busy={busy} onClose={onClose}>
    <form className="dialog-surface rename-work-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-work-title" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h2 id="rename-work-title">修改图库名称</h2>
      <label>图库名称<input ref={input} aria-label="图库名称" value={name} maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /></label>
      <p>只改图库里显示的名称。多页作品共用这个名称，原文件名保持不变。</p>
      {error && <p role="alert">{error}</p>}
      <footer><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={!name.trim()} busy={busy} busyLabel="正在保存…">保存名称</Button></footer>
    </form>
  </DialogOverlay>;
}
