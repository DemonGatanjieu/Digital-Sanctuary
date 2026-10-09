import type { WorkElementFilter, WorkQuery } from "@sanctuary/domain";

/** Common tagger tags with Chinese names; anything else can be typed as a raw tag. */
export const ELEMENT_OPTIONS: ReadonlyArray<readonly [label: string, tag: string]> = [
  ["单人", "solo"], ["多位女孩", "multiple_girls"], ["男性", "1boy"], ["无人物", "no_humans"],
  ["黑发", "black_hair"], ["白发", "white_hair"], ["金发", "blonde_hair"], ["蓝发", "blue_hair"],
  ["眼镜", "glasses"], ["猫耳", "cat_ears"], ["兽耳", "animal_ears"], ["泳装", "swimsuit"],
  ["海边", "beach"], ["天空", "sky"], ["夜晚", "night"], ["花", "flower"],
  ["风景", "scenery"], ["单色", "monochrome"], ["线稿", "lineart"], ["血迹", "blood"]
];

export function elementLabel(tag: string): string {
  return ELEMENT_OPTIONS.find(([, value]) => value === tag)?.[0] ?? tag.replaceAll("_", " ");
}

export function hasElementConditions(filter: WorkElementFilter | undefined): boolean {
  return Boolean(filter?.include?.length || filter?.exclude?.length || filter?.blocked);
}

/** Replaces the element conditions, dropping the field when nothing is left. */
export function withElements(query: WorkQuery, filter: WorkElementFilter | null): WorkQuery {
  const { elements: _current, ...rest } = query;
  const next: WorkElementFilter = {};
  if (filter?.include?.length) next.include = [...new Set(filter.include)];
  if (filter?.exclude?.length) next.exclude = [...new Set(filter.exclude)].filter((tag) => !next.include?.includes(tag));
  if (filter?.blocked) next.blocked = true;
  return { ...rest, ...(hasElementConditions(next) ? { elements: next } : {}), offset: 0 };
}

/** Comma- or space-separated raw tags, as typed. */
export function parseTagList(text: string): string[] {
  return [...new Set(text.split(/[,，\s]+/).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}
