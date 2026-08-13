import { useEffect, useRef, useState } from "react";
import type { CollectionRecord } from "@sanctuary/domain";
import { DialogOverlay } from "./DialogOverlay";

export interface CollectionDraft {
  name: string;
  description: string;
}

export function CollectionEditor({
  collection,
  saving,
  onSave,
  onDelete,
  onClose
}: {
  collection: CollectionRecord | null;
  saving: boolean;
  onSave: (draft: CollectionDraft) => Promise<void>;
  onDelete: (() => Promise<void>) | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(collection?.name ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  return (
    <DialogOverlay busy={saving} onClose={onClose}>
      <form
        className="dialog-surface collection-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-editor-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void onSave({ name: name.trim(), description: description.trim() });
        }}
      >
        <p className="eyebrow">{collection ? "EDIT COLLECTION" : "NEW COLLECTION"}</p>
        <h2 id="collection-editor-title">{collection ? "编辑分类" : "新建分类"}</h2>
        <label>
          <span>名称</span>
          <input ref={nameRef} value={name} maxLength={80} placeholder="例如：背景与氛围" onChange={(event) => setName(event.target.value)} />
          <small>{name.length} / 80</small>
        </label>
        <label>
          <span>介绍</span>
          <textarea value={description} maxLength={500} rows={4} placeholder="可选：记录这个分类收集什么样的作品" onChange={(event) => setDescription(event.target.value)} />
          <small>{description.length} / 500</small>
        </label>
        <div className="collection-editor-note">分类只保存组织关系；编辑或删除分类都不会删除图片文件。</div>
        {confirmDelete && (
          <div className="collection-delete-confirm">
            <span>确认删除“{collection?.name}”分类？其中作品会保留在画廊。</span>
            <button type="button" disabled={saving} onClick={() => onDelete && void onDelete()}>确认删除</button>
          </div>
        )}
        <footer>
          <div>
            {onDelete && !confirmDelete && <button type="button" className="collection-delete-trigger" disabled={saving} onClick={() => setConfirmDelete(true)}>删除分类</button>}
          </div>
          <div>
            <button type="button" className="secondary" disabled={saving} onClick={onClose}>取消</button>
            <button type="submit" className="primary" disabled={saving || !name.trim()}>{saving ? "正在保存…" : "保存"}</button>
          </div>
        </footer>
      </form>
    </DialogOverlay>
  );
}
