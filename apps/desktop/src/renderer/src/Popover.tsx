import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";

export type PopoverAnchor = HTMLElement | { x: number; y: number };

/**
 * Floating panel anchored to an element (dropdowns) or a point (context menus).
 * It owns Escape while open, closes on outside pointer-down, and keeps itself inside the viewport.
 */
export function Popover({ anchor, onClose, children, label, align = "start", role = "menu", className = "" }: {
  anchor: PopoverAnchor;
  onClose: () => void;
  children: ReactNode;
  label: string;
  align?: "start" | "end";
  role?: "menu" | "dialog";
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const margin = 8;
    let left: number, top: number, above: number;
    if (anchor instanceof HTMLElement) {
      const rect = anchor.getBoundingClientRect();
      left = align === "end" ? rect.right - box.width : rect.left;
      top = rect.bottom + 4;
      above = rect.top - 4 - box.height;
    } else {
      left = anchor.x;
      top = anchor.y;
      above = anchor.y - box.height;
    }
    if (top + box.height > innerHeight - margin && above >= margin) top = above;
    left = Math.max(margin, Math.min(left, innerWidth - box.width - margin));
    top = Math.max(margin, Math.min(top, innerHeight - box.height - margin));
    setPosition({ left, top });
  }, [anchor, align]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = panel.current;
    const close = () => closeRef.current();
    const focusTimer = window.setTimeout(() => {
      (panel.current?.querySelector<HTMLElement>("[role^=menuitem]:not(:disabled), input, button:not(:disabled)") ?? panel.current)?.focus();
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (role !== "menu") return;
      // While a menu is open it owns the keyboard: arrows, Home/End and shortcuts must not reach the page or viewer behind it.
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        if (event.key !== "Tab" && event.key !== "Enter" && event.key !== " ") event.stopImmediatePropagation();
        return;
      }
      event.stopImmediatePropagation();
      const items = [...(panel.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)") ?? [])];
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "ArrowDown" ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (panel.current?.contains(event.target as Node)) return;
      if (anchor instanceof HTMLElement && anchor.contains(event.target as Node)) return;
      close();
    };
    const onScroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) close(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      const active = document.activeElement;
      if (previous?.isConnected && (!active || active === document.body || element?.contains(active))) previous.focus();
    };
  }, [anchor, role]);

  return createPortal(
    <div
      ref={panel}
      className={`ui-popover ${className}`.trim()}
      role={role}
      aria-label={label}
      tabIndex={-1}
      style={position ? { left: position.left, top: position.top } : { left: -9999, top: -9999 }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>,
    document.body
  );
}

export function MenuItem({ icon, label, hint, danger, checked, disabled, onSelect }: {
  icon?: IconName;
  label: ReactNode;
  hint?: ReactNode;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      className={`ui-menu-item ${danger ? "ui-menu-item--danger" : ""}`.trim()}
      disabled={disabled}
      onClick={onSelect}
    >
      {checked !== undefined ? <Icon name="check" size={16} style={{ opacity: checked ? 1 : 0 }} /> : icon ? <Icon name={icon} size={16} /> : null}
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="ui-menu-separator" role="separator" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="ui-menu-label">{children}</div>;
}
