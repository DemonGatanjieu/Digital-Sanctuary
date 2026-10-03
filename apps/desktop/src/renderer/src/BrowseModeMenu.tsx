import { useRef } from "react";
import { SegmentedControl, type SegmentOption } from "./SegmentedControl";

export function BrowseModeMenu<T extends string>({ value, options, label, onChange }: {
  value: T; options: readonly SegmentOption<T>[]; label: string; compact?: boolean; onChange: (value: T) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  return <details ref={menu} className="browse-mode-menu" onKeyDown={(event) => {
    if (event.key === "Escape" && menu.current?.open && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault(); event.stopPropagation();
      menu.current.open = false; menu.current.querySelector("summary")?.focus();
    }
  }}>
    <summary>浏览方式 <strong>{options.find((option) => option.value === value)?.label}</strong></summary>
    <SegmentedControl compact value={value} options={options} label={label} onChange={(next) => {
      onChange(next);
      if (menu.current) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); }
    }} />
  </details>;
}
