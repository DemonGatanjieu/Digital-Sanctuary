export interface QuickActionDescriptor {
  id: string;
  label: string;
  description?: string;
  keywords?: readonly string[];
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

/** Every search word must match, while action order remains predictable. */
export function filterQuickActions<T extends QuickActionDescriptor>(
  actions: readonly T[],
  query: string
): T[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...actions];

  return actions.filter((action) => {
    const searchable = normalizeSearch([
      action.label,
      action.description ?? "",
      ...(action.keywords ?? [])
    ].join(" "));
    return words.every((word) => searchable.includes(word));
  });
}

/** Wrap through available actions without selecting disabled operations. */
export function nextQuickActionIndex(
  actions: readonly QuickActionDescriptor[],
  currentIndex: number,
  direction: 1 | -1
): number {
  if (actions.length === 0) return -1;
  const start = currentIndex >= 0 && currentIndex < actions.length
    ? currentIndex
    : direction === 1 ? -1 : 0;

  for (let step = 1; step <= actions.length; step += 1) {
    const index = (start + direction * step + actions.length) % actions.length;
    if (!actions[index]?.disabled) return index;
  }
  return -1;
}
