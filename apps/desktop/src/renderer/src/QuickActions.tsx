import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "./Button";
import { DialogOverlay } from "./DialogOverlay";
import { filterQuickActions, nextQuickActionIndex, type QuickActionDescriptor } from "./quick-action-model";

export interface QuickAction extends QuickActionDescriptor {
  onSelect: () => void | Promise<void>;
}

/** Mount only while open; the application owns the global opening shortcut. */
export function QuickActions({
  actions,
  onClose,
  onError
}: {
  actions: readonly QuickAction[];
  onClose: (reason?: "execute") => void;
  onError: (error: unknown) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const executingRef = useRef(false);
  const panelId = useId();
  const resultsId = `${panelId}-results`;
  const filtered = useMemo(() => filterQuickActions(actions, query), [actions, query]);
  const activeIndex = filtered.findIndex((action) => action.id === activeId && !action.disabled);
  const selectedIndex = activeIndex >= 0 ? activeIndex : filtered.findIndex((action) => !action.disabled);
  const selectedAction = filtered[selectedIndex];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (selectedIndex >= 0) {
      document.getElementById(`${panelId}-option-${selectedIndex}`)
        ?.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  }, [panelId, selectedIndex]);

  function execute(action: QuickAction | undefined) {
    if (!action || action.disabled || executingRef.current) return;
    executingRef.current = true;
    onClose("execute");
    // Close before an action can open a native picker or another application dialog.
    void Promise.resolve().then(() => action.onSelect()).catch(onError);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Tab") return; // Shared DialogOverlay owns the focus loop.
    event.stopPropagation(); // Background viewers must not receive modal typing/arrows.
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = nextQuickActionIndex(filtered, selectedIndex, event.key === "ArrowDown" ? 1 : -1);
      setActiveId(filtered[index]?.id ?? null);
      inputRef.current?.focus();
    } else if (event.key === "Enter" && event.target === inputRef.current) {
      event.preventDefault();
      execute(selectedAction);
    }
  }

  return (
    <DialogOverlay onClose={onClose}>
      <section className="dialog-surface quick-actions-dialog" role="dialog" aria-modal="true"
        aria-labelledby={`${panelId}-title`} onKeyDown={handleKeyDown}>
        <header className="quick-actions-heading">
          <div>
            <h2 id={`${panelId}-title`}>快捷操作</h2>
            <p>想做什么，输入操作名称即可。</p>
          </div>
          <Button variant="ghost" className="quick-actions-close" onClick={() => onClose()} aria-label="关闭快捷操作">
            <span aria-hidden="true">×</span>
          </Button>
        </header>
        <input ref={inputRef} className="quick-actions-search" type="text" role="combobox"
          aria-label="搜索快捷操作" aria-autocomplete="list" aria-expanded="true"
          aria-controls={resultsId}
          aria-activedescendant={selectedAction ? `${panelId}-option-${selectedIndex}` : undefined}
          placeholder="输入操作，如「导入」「相册」「模型」" autoComplete="off" spellCheck={false}
          value={query} onChange={(event) => { setQuery(event.target.value); setActiveId(null); }} />
        <div className="quick-actions-results" id={resultsId} role="listbox" aria-label="可用操作">
          {filtered.map((action, index) => (
            <Button key={action.id} id={`${panelId}-option-${index}`} role="option" variant="ghost"
              className={`quick-action-option${index === selectedIndex ? " is-active" : ""}`}
              aria-selected={index === selectedIndex} disabled={action.disabled}
              onFocus={() => setActiveId(action.id)} onPointerMove={() => { if (!action.disabled) setActiveId(action.id); }}
              onClick={() => execute(action)}>
              <span className="quick-action-copy">
                <strong>{action.label}</strong>
                {(action.description || action.disabledReason) &&
                  <small>{action.disabled ? action.disabledReason ?? action.description : action.description}</small>}
              </span>
              {action.shortcut && <kbd className="quick-action-shortcut">{action.shortcut}</kbd>}
            </Button>
          ))}
        </div>
        {filtered.length === 0 && <p className="quick-actions-empty" role="status">没有匹配的操作，试试「图库」「导入」或「设置」。</p>}
        <footer className="quick-actions-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 执行</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </footer>
      </section>
    </DialogOverlay>
  );
}
