// Align each organizer batch with the validated work-deletion IPC boundary.
export const TRIAGE_SELECTION_LIMIT = 500;

export function toggleTriageSelection(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else if (next.size < TRIAGE_SELECTION_LIMIT) next.add(id);
  return next;
}

export function visibleTriageSelection(ids: readonly string[], visibleCount: number): Set<string> {
  return new Set([...new Set(ids.slice(0, visibleCount))].slice(0, TRIAGE_SELECTION_LIMIT));
}
