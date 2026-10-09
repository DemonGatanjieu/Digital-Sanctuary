import type { FilterRule, WorkQuery } from "@sanctuary/domain";

/** Same cut-off the organizer used for "needs / excludes" conditions. */
export const ELEMENT_CONDITION_CONFIDENCE = 0.4;

/**
 * Turns the renderer's element conditions into thresholds for the active tagger.
 * Without a tagger nothing is known, so an engine-less match finds nothing rather than everything.
 */
export function withElementMatch(query: WorkQuery, engine: string | null, rules: () => readonly FilterRule[]): WorkQuery {
  const { elements, elementMatch: _ignored, ...rest } = query;
  if (!elements) return rest;
  const condition = (tag: string) => ({ tag, minimum: ELEMENT_CONDITION_CONFIDENCE });
  const blocked = elements.blocked
    ? rules().filter((rule) => rule.enabled).map((rule) => ({ tag: rule.label, minimum: rule.minimumConfidence }))
    : [];
  return {
    ...rest,
    elements,
    elementMatch: {
      engine: engine ?? "",
      include: (elements.include ?? []).map(condition),
      exclude: (elements.exclude ?? []).map(condition),
      // "含有我屏蔽的元素" with no enabled rule matches nothing.
      anyOf: elements.blocked && !blocked.length ? [{ tag: "\u0000no-rule", minimum: 1 }] : blocked
    }
  };
}
