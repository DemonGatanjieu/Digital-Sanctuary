import type { WorkbenchQuery } from "@sanctuary/domain";

/** One user request; only the backend needs to distinguish the analysis engines. */
export function workbenchQuery(text:string,elements:Record<string,"include"|"exclude">,customInclude="",customExclude=""):WorkbenchQuery {
  const tags=(kind:"include"|"exclude",custom:string)=>[...new Set([...Object.entries(elements).filter(([,value])=>value===kind).map(([tag])=>tag),...custom.split(/[\s,，]+/).filter(Boolean)])];
  const include=tags("include",customInclude),exclude=tags("exclude",customExclude);
  const description=text.trim();
  return {mode:description?"description":include.length||exclude.length?"elements":"rules",text:description,include,exclude};
}
