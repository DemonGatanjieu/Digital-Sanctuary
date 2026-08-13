export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  label,
  compact = false,
  onChange
}: {
  value: T;
  options: readonly SegmentOption<T>[];
  label: string;
  compact?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className={`ui-segmented ${compact ? "ui-segmented--compact" : ""}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? "active" : ""}
          aria-pressed={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
