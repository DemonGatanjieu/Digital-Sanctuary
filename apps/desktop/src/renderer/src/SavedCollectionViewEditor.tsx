import { useEffect, useId, useMemo, useState } from "react";
import type {
  CollectionMatchMode,
  CollectionRecord,
  SavedCollectionView,
  SavedCollectionViewDraft,
  WorkListItem
} from "@sanctuary/domain";
import { DialogOverlay } from "./DialogOverlay";
import { Button } from "./Button";
import { SegmentedControl } from "./SegmentedControl";

export function SavedCollectionViewEditor({
  editingView,
  collections,
  existingViews,
  onClose,
  onSave,
  onApplyTemporarily
}: {
  editingView: SavedCollectionView | null;
  collections: CollectionRecord[];
  existingViews: SavedCollectionView[];
  onClose: () => void;
  onSave: (draft: SavedCollectionViewDraft, viewId?: string) => Promise<void>;
  onApplyTemporarily: (query: {
    collectionIds: string[];
    collectionMatchMode: CollectionMatchMode;
    excludedCollectionIds: string[];
  }) => void;
}) {
  const titleId = useId();
  const [name, setName] = useState(editingView?.name ?? "");
  const [matchMode, setMatchMode] = useState<CollectionMatchMode>(editingView?.matchMode ?? "all");
  const [includedIds, setIncludedIds] = useState<Set<string>>(
    new Set(editingView?.includedCollectionIds ?? [])
  );
  const [excludedIds, setExcludedIds] = useState<Set<string>>(
    new Set(editingView?.excludedCollectionIds ?? [])
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [previewItems, setPreviewItems] = useState<WorkListItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const validCollectionIds = useMemo(() => new Set(collections.map((c) => c.id)), [collections]);
  const missingIncludedCount = useMemo(
    () => [...includedIds].filter((id) => !validCollectionIds.has(id)).length,
    [includedIds, validCollectionIds]
  );
  const missingExcludedCount = useMemo(
    () => [...excludedIds].filter((id) => !validCollectionIds.has(id)).length,
    [excludedIds, validCollectionIds]
  );

  const isDuplicateName = useMemo(() => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return false;
    return existingViews.some(
      (view) => view.name.toLowerCase() === trimmed && view.id !== editingView?.id
    );
  }, [name, existingViews, editingView]);

  // Debounced real-time preview computation
  useEffect(() => {
    const included = [...includedIds].filter((id) => validCollectionIds.has(id));
    const excluded = [...excludedIds].filter((id) => validCollectionIds.has(id));
    let cancelled = false;

    const timer = window.setTimeout(() => {
      setPreviewLoading(true);
      void window.sanctuary
        .queryWorks({
          ...(included.length > 0 ? { collectionIds: included } : {}),
          ...(included.length > 1 ? { collectionMatchMode: matchMode } : {}),
          ...(excluded.length > 0 ? { excludedCollectionIds: excluded } : {}),
          limit: 5
        })
        .then((res) => {
          if (cancelled) return;
          setPreviewTotal(res.total);
          setPreviewItems(res.items);
        })
        .catch(() => {
          if (cancelled) return;
          setPreviewTotal(null);
          setPreviewItems([]);
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [includedIds, excludedIds, matchMode, validCollectionIds]);

  const toggleInclude = (id: string) => {
    setIncludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        setExcludedIds((ex) => {
          const nextEx = new Set(ex);
          nextEx.delete(id);
          return nextEx;
        });
      }
      return next;
    });
  };

  const toggleExclude = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        setIncludedIds((inc) => {
          const nextInc = new Set(inc);
          nextInc.delete(id);
          return nextInc;
        });
      }
      return next;
    });
  };

  const clearAllSelections = () => {
    setIncludedIds(new Set());
    setExcludedIds(new Set());
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请输入组合名称");
      return;
    }
    if (isDuplicateName) {
      setError(`组合名称“${trimmedName}”已存在，请换一个名称`);
      return;
    }
    if (includedIds.size === 0 && excludedIds.size === 0) {
      setError("请至少选择一个包含或排除的分类");
      return;
    }

    setError("");
    setSaving(true);
    try {
      await onSave(
        {
          name: trimmedName,
          matchMode,
          includedCollectionIds: [...includedIds],
          excludedCollectionIds: [...excludedIds]
        },
        editingView?.id
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleApplyTemporarily = () => {
    onApplyTemporarily({
      collectionIds: [...includedIds].filter((id) => validCollectionIds.has(id)),
      collectionMatchMode: matchMode,
      excludedCollectionIds: [...excludedIds].filter((id) => validCollectionIds.has(id))
    });
    onClose();
  };

  return (
    <DialogOverlay onClose={onClose}>
      <section className="dialog-shell saved-view-editor-dialog" aria-labelledby={titleId}>
        <header className="dialog-header">
          <div>
            <p className="eyebrow">SAVED COLLECTION VIEW</p>
            <h2 id={titleId}>{editingView ? "编辑相册组合" : "新建相册组合"}</h2>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <div className="saved-view-editor-body">
          {error && <div className="app-notice app-notice-error">{error}</div>}

          {(missingIncludedCount > 0 || missingExcludedCount > 0) && (
            <div className="app-notice app-notice-warning">
              此组合包含 {missingIncludedCount + missingExcludedCount} 个已被删除的相册，已自动忽略其筛选作用。
            </div>
          )}

          <div className="saved-view-form-group">
            <label htmlFor="saved-view-name">组合名称</label>
            <input
              id="saved-view-name"
              type="text"
              className={`saved-view-name-input ${isDuplicateName ? "has-error" : ""}`}
              placeholder="例如：白发 + 夜景 - 血腥"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError("");
              }}
              autoFocus
            />
            {isDuplicateName && <small className="field-error-text">该组合名称已存在</small>}
          </div>

          <div className="saved-view-form-group">
            <div className="saved-view-mode-header">
              <label>匹配规则</label>
              <SegmentedControl
                label="匹配模式"
                value={matchMode}
                options={[
                  { value: "all", label: "全部满足 (AND)" },
                  { value: "any", label: "任意满足 (OR)" }
                ]}
                onChange={(mode) => setMatchMode(mode as CollectionMatchMode)}
              />
            </div>
            <p className="saved-view-mode-desc">
              {matchMode === "all"
                ? "作品必须同时包含所有选定的“包含”相册，且不含任何“排除”相册。"
                : "作品包含任意一个“包含”相册即可（或留空代表全库），且不含任何“排除”相册。"}
            </p>
          </div>

          <div className="saved-view-form-group">
            <div className="saved-view-collections-header">
              <label>选择相册 ({collections.length})</label>
              {(includedIds.size > 0 || excludedIds.size > 0) && (
                <button type="button" className="btn-link" onClick={clearAllSelections}>
                  清除全部选择
                </button>
              )}
            </div>

            <div className="saved-view-collections-list">
              {collections.length === 0 ? (
                <div className="empty-hint">当前还没有创建任何相册。</div>
              ) : (
                collections.map((col) => {
                  const isInc = includedIds.has(col.id);
                  const isExc = excludedIds.has(col.id);
                  return (
                    <div
                      key={col.id}
                      className={`saved-view-collection-item ${isInc ? "is-included" : isExc ? "is-excluded" : ""}`}
                    >
                      <div className="saved-view-col-info">
                        <span className="saved-view-col-name">{col.name}</span>
                        {col.description && (
                          <span className="saved-view-col-desc">{col.description}</span>
                        )}
                      </div>
                      <div className="saved-view-col-actions">
                        <button
                          type="button"
                          className={`btn-pill-action btn-include ${isInc ? "active" : ""}`}
                          onClick={() => toggleInclude(col.id)}
                          title={isInc ? "取消包含" : "设为包含"}
                        >
                          {isInc ? "✓ 包含" : "+ 包含"}
                        </button>
                        <button
                          type="button"
                          className={`btn-pill-action btn-exclude ${isExc ? "active" : ""}`}
                          onClick={() => toggleExclude(col.id)}
                          title={isExc ? "取消排除" : "设为排除"}
                        >
                          {isExc ? "✕ 已排除" : "- 排除"}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="saved-view-preview-section">
            <div className="saved-view-preview-header">
              <span>实时匹配预览</span>
              <strong>
                {previewLoading
                  ? "正在计算…"
                  : previewTotal !== null
                  ? `${previewTotal} 个作品`
                  : "0 个作品"}
              </strong>
            </div>
            <div className="saved-view-preview-thumbs">
              {previewItems.length === 0 ? (
                <div className="empty-preview-text">
                  {previewLoading ? "计算中…" : "当前组合下没有匹配的作品"}
                </div>
              ) : (
                previewItems.map((item) => (
                  <div key={item.id} className="preview-thumb-box">
                    {item.coverAsset ? (
                      <img
                        src={localImageUrl(item.coverAsset.thumbnailPath ?? item.coverAsset.path)}
                        alt={item.title}
                        loading="lazy"
                      />
                    ) : (
                      <span className="thumb-placeholder">✦</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <footer className="dialog-footer saved-view-footer">
          <Button type="button" variant="ghost" onClick={handleApplyTemporarily}>
            临时查看
          </Button>
          <div className="dialog-footer-right">
            <Button type="button" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSave}
              busy={saving}
              busyLabel="正在保存…"
              disabled={isDuplicateName || !name.trim()}
            >
              保存组合
            </Button>
          </div>
        </footer>
      </section>
    </DialogOverlay>
  );
}

function localImageUrl(path: string): string {
  return `sanctuary-image://local/${encodeURIComponent(path)}`;
}
