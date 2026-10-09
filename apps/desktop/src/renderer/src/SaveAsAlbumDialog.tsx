import { useEffect, useRef, useState } from "react";
import type { CollectionRecord } from "@sanctuary/domain";
import { DialogOverlay } from "./DialogOverlay";
import { Button } from "./Button";

/** Names the album a filtered gallery or a picture search becomes; the caller decides which works. */
export function SaveAsAlbumDialog({ suggestedName, count, onSave, onClose }: {
  suggestedName: string;
  count: number;
  onSave: (name: string) => Promise<{ collection: CollectionRecord; workCount: number }>;
  onClose: () => void;
}) {
  const [name, setName] = useState(suggestedName.slice(0, 80)), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null), composing = useRef(false), pending = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  async function save() {
    if (pending.current || composing.current || !name.trim()) return;
    pending.current = true; setBusy(true); setError("");
    try { await onSave(name.trim()); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "存为相册失败，请重试"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <DialogOverlay busy={busy} onClose={onClose}>
    <form className="dialog-surface rename-work-dialog" role="dialog" aria-modal="true" aria-labelledby="save-as-album-title" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h2 id="save-as-album-title">存为相册</h2>
      <label>相册名称<input ref={input} aria-label="新相册名称" value={name} maxLength={80} disabled={busy} onChange={(event) => setName(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /></label>
      <p>把当前结果的 {count} 件作品放进一个新相册。之后改动筛选，相册里的作品不会跟着变。</p>
      {error && <p role="alert">{error}</p>}
      <footer><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={!name.trim()} busy={busy} busyLabel="正在保存…">存为相册</Button></footer>
    </form>
  </DialogOverlay>;
}
