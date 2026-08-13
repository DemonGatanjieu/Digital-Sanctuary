export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PersistedWindowState extends WindowBounds {
  maximized: boolean;
}

export function normalizeWindowState(value: unknown, workAreas: readonly WindowBounds[]): PersistedWindowState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PersistedWindowState>;
  if (![candidate.x, candidate.y, candidate.width, candidate.height].every(Number.isFinite) || typeof candidate.maximized !== "boolean") return null;
  const state: PersistedWindowState = {
    x: Math.round(candidate.x as number),
    y: Math.round(candidate.y as number),
    width: Math.max(900, Math.round(candidate.width as number)),
    height: Math.max(620, Math.round(candidate.height as number)),
    maximized: candidate.maximized
  };
  const workArea = workAreas.find((area) =>
    state.x < area.x + area.width - 120 && state.x + state.width > area.x + 120 &&
    state.y < area.y + area.height - 80 && state.y + state.height > area.y + 80
  );
  if (!workArea) return null;
  state.width = Math.min(state.width, workArea.width);
  state.height = Math.min(state.height, workArea.height);
  state.x = Math.min(workArea.x + workArea.width - state.width, Math.max(workArea.x, state.x));
  state.y = Math.min(workArea.y + workArea.height - state.height, Math.max(workArea.y, state.y));
  return state;
}
