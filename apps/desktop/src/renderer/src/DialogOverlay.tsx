import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function isDialogComposition(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

/** Only one window listener may consume Escape; IME keeps its native candidate action. */
export function handleDialogEscape(
  event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "isComposing" | "keyCode" | "preventDefault" | "stopImmediatePropagation">,
  { topmost, busy, onClose }: { topmost: boolean; busy: boolean; onClose: () => void }
): boolean {
  if (event.key !== "Escape" || event.defaultPrevented || isDialogComposition(event) || !topmost) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!busy) onClose();
  return true;
}

export function DialogOverlay({
  children,
  busy = false,
  onClose
}: {
  children: ReactNode;
  busy?: boolean;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const isTopmost = () => overlayRef.current === [...document.querySelectorAll(".dialog-overlay")].at(-1);
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const overlay = overlayRef.current;
      if (overlay && isTopmost() && !overlay.contains(document.activeElement)) {
        overlay.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
      }
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      const topmost = isTopmost();
      if (handleDialogEscape(event, { topmost, busy: busyRef.current, onClose: () => closeRef.current() })) return;
      if (event.key !== "Tab" || !topmost || event.defaultPrevented || isDialogComposition(event)) return;

      const focusable = [...(overlayRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !overlayRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !overlayRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return createPortal(
    <div
      ref={overlayRef}
      className="dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busyRef.current) closeRef.current();
      }}
    >
      {children}
    </div>,
    document.body
  );
}
