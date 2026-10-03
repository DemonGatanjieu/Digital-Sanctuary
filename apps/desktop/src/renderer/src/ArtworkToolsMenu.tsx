import { useRef, type ReactNode } from "react";

export function ArtworkToolsMenu({ children }: { children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  return <details ref={menu} className="artwork-tools-menu" onKeyDown={(event) => {
    if (!menu.current?.open) return;
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault(); menu.current.open = false; menu.current.querySelector("summary")?.focus();
    }
  }}>
    <summary>分析与创作</summary>
    <div className="artwork-tools-options" onClick={(event) => {
      if ((event.target as Element).closest("button") && menu.current) {
        menu.current.open = false; menu.current.querySelector("summary")?.focus();
      }
    }}>{children}</div>
  </details>;
}
