import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { BookmarkDownloadPreview } from "../../shared/pixiv-download.js";

export function BookmarkDownloadDialog({
  preview,
  busy,
  onConfirm,
  onClose
}: {
  preview: BookmarkDownloadPreview;
  busy: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return createPortal(
    <div className="bookmark-dialog-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="bookmark-dialog" role="dialog" aria-modal="true" aria-labelledby="bookmark-dialog-title">
        <p className="eyebrow">BOOKMARK DOWNLOAD</p>
        <h2 id="bookmark-dialog-title">下载收藏中的 {preview.total} 个作品？</h2>
        <div className="bookmark-dialog-summary">
          <strong>{preview.total}</strong>
          <span>个 Pixiv 收藏作品</span>
          <small>用户 {preview.userId}</small>
        </div>
        <ul>
          <li>多页作品会作为一个作品完整保存。</li>
          <li>已经保存的图片会跳过，不产生重复副本。</li>
          <li>主动收藏视为可信内容，不执行 AI 审查或模糊。</li>
          <li>下载在任务中心持续显示，界面不会被阻断。</li>
        </ul>
        <footer>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button>
          <button ref={confirmRef} type="button" className="primary" disabled={busy} onClick={() => void onConfirm()}>{busy ? "正在开始…" : "开始下载"}</button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
