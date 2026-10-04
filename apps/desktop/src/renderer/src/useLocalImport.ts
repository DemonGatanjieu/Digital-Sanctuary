import { useEffect, useRef, useState } from "react";
import type { LocalImportBatch, LocalImportOptions } from "@sanctuary/domain";

export function useLocalImport(onChanged: () => Promise<void>, onError: (error: unknown) => void) {
  const [batch, setBatch] = useState<LocalImportBatch | null>(null);
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [error, setError] = useState("");
  const callbacks = useRef({ onChanged, onError });
  callbacks.current = { onChanged, onError };
  const choosingRef = useRef(false);

  useEffect(() => {
    if (!batch || batch.phase !== "running") return;
    let active = true;
    let timer: number | undefined;
    let count = batch.items.filter((item) => ["imported", "existing", "duplicate"].includes(item.status)).length;
    const poll = async () => {
      try {
        const next = await window.sanctuary.getImportBatch(batch.id);
        if (!active) return;
        const nextCount = next.items.filter((item) => ["imported", "existing", "duplicate"].includes(item.status)).length;
        if (nextCount !== count) { count = nextCount; await callbacks.current.onChanged(); }
        if (!active) return;
        setBatch(next);
        if (next.phase === "running") timer = window.setTimeout(() => void poll(), 600);
      } catch (error) { if (active) { callbacks.current.onError(error); timer = window.setTimeout(() => void poll(), 2000); } }
    };
    timer = window.setTimeout(() => void poll(), 100);
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [batch?.id, batch?.phase]);

  async function choose() {
    if (batch?.phase === "running" || batch?.phase === "ready") { setOpen(true); return; }
    if (choosingRef.current) return;
    choosingRef.current = true; setChoosing(true);
    try { const next = await window.sanctuary.importImages(); if (next) { setBatch(next); setOpen(true); } }
    catch (error) { callbacks.current.onError(error); }
    finally { choosingRef.current = false; setChoosing(false); }
  }

  async function command(action: "start" | "cancel" | "retry", options?: LocalImportOptions) {
    if (!batch || commandBusy) return;
    setError("");
    setCommandBusy(true);
    try {
      setBatch(action === "start" ? await window.sanctuary.startImportBatch(batch.id, options!)
        : action === "cancel" ? await window.sanctuary.cancelImportBatch(batch.id)
        : await window.sanctuary.retryImportBatch(batch.id));
    } catch (error) { setError(error instanceof Error ? error.message : "导入操作失败，请重试"); }
    finally { setCommandBusy(false); }
  }
  return { batch, open, choosing, commandBusy, error, choose, command,
    show: () => setOpen(true), close: () => { setOpen(false); setError(""); if (batch?.phase === "ready") setBatch(null); } };
}
