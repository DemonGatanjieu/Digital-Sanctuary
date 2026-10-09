import { useState } from "react";
import type { CollectionRecord, WorkOwnership, WorkQuery, WorkType } from "@sanctuary/domain";
import { Icon } from "./Icon";
import { MenuItem, MenuLabel, MenuSeparator, Popover } from "./Popover";
import { SavedWorkFiltersDialog } from "./SavedWorkFilters";
import { ElementFilterDialog } from "./ElementFilterDialog";
import { withElements } from "./element-filters";
import { OWNERSHIP_LABELS, PRESET_LABELS, SORT_LABELS, WORK_TYPE_LABELS, clearAllWorkFilters, withOwnership, withWorkType, type WorkFilterChip } from "./work-filters";
import { applyWorkPreset, getWorkPreset, type WorkPreset, type WorkSortSnapshot } from "./work-presets";

export function FilterMenuButton({ query, collections, normalSort, activeCount, onQueryChange }: {
  query: WorkQuery;
  collections: CollectionRecord[];
  normalSort: WorkSortSnapshot;
  activeCount: number;
  onQueryChange: (query: WorkQuery) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [elementsOpen, setElementsOpen] = useState(false);
  const elements = query.elements;
  const elementCount = (elements?.include?.length ?? 0) + (elements?.exclude?.length ?? 0);
  const preset = getWorkPreset(query);
  const apply = (next: WorkQuery) => { onQueryChange(next); setAnchor(null); };
  return <>
    <button type="button" className="ui-tool-button" aria-label={activeCount ? `筛选（${activeCount} 项生效）` : "筛选"} aria-haspopup="menu" aria-expanded={Boolean(anchor)} data-gallery-filter
      onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>
      <Icon name="filter" size={16} /><span>筛选</span>{activeCount > 0 && <span className="ui-count">{activeCount}</span>}
    </button>
    {anchor && <Popover anchor={anchor} label="筛选" align="end" onClose={() => setAnchor(null)} className="work-filter-menu">
      <MenuLabel>显示</MenuLabel>
      {(Object.keys(PRESET_LABELS) as WorkPreset[]).map((value) => (
        <MenuItem key={value} label={PRESET_LABELS[value]} checked={preset === value} onSelect={() => apply(applyWorkPreset(query, value, normalSort))} />
      ))}
      <MenuSeparator />
      <MenuLabel>类型</MenuLabel>
      <MenuItem label="全部类型" checked={!query.workType} onSelect={() => apply(withWorkType(query, null))} />
      {(Object.keys(WORK_TYPE_LABELS) as WorkType[]).map((value) => (
        <MenuItem key={value} label={WORK_TYPE_LABELS[value]} checked={query.workType === value} onSelect={() => apply(withWorkType(query, value))} />
      ))}
      <MenuSeparator />
      <MenuLabel>保存方式</MenuLabel>
      <MenuItem label="全部" checked={!query.ownership} onSelect={() => apply(withOwnership(query, null))} />
      {(Object.keys(OWNERSHIP_LABELS) as WorkOwnership[]).map((value) => (
        <MenuItem key={value} label={OWNERSHIP_LABELS[value]} checked={query.ownership === value} onSelect={() => apply(withOwnership(query, value))} />
      ))}
      <MenuSeparator />
      <MenuLabel>元素</MenuLabel>
      <MenuItem label="含有我屏蔽的元素" checked={Boolean(elements?.blocked)} onSelect={() => apply(withElements(query, { ...elements, blocked: !elements?.blocked }))} />
      <MenuItem label="选择元素…" hint={elementCount ? `${elementCount} 项` : undefined} onSelect={() => { setAnchor(null); setElementsOpen(true); }} />
      <MenuSeparator />
      <MenuItem icon="folder" label="常用筛选…" hint="保存 / 恢复" onSelect={() => { setAnchor(null); setSavedOpen(true); }} />
      {activeCount > 0 && <MenuItem icon="close" label="清除全部筛选" onSelect={() => apply(clearAllWorkFilters(query, normalSort))} />}
    </Popover>}
    {elementsOpen && <ElementFilterDialog value={elements} onApply={(filter) => onQueryChange(withElements(query, filter))} onClose={() => setElementsOpen(false)} />}
    {savedOpen && <SavedWorkFiltersDialog query={query} collections={collections} onApply={onQueryChange} onClose={() => setSavedOpen(false)} />}
  </>;
}

export function SortMenuButton({ query, disabledReason, onQueryChange }: {
  query: WorkQuery;
  disabledReason?: string | undefined;
  onQueryChange: (query: WorkQuery) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const sortBy = query.sortBy ?? "savedAt";
  const direction = query.direction ?? "desc";
  const label = disabledReason ?? (sortBy === "lastViewedAt" ? "浏览时间" : SORT_LABELS[sortBy]);
  const apply = (next: WorkQuery) => { onQueryChange({ ...next, offset: 0 }); setAnchor(null); };
  return <>
    <button type="button" className="ui-tool-button" aria-label={`排序：${label}`} aria-haspopup="menu" aria-expanded={Boolean(anchor)} disabled={Boolean(disabledReason)}
      title={disabledReason ? `当前按${disabledReason}排列` : "排序"} onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>
      <Icon name="sort" size={16} /><span>{label}</span>
    </button>
    {anchor && <Popover anchor={anchor} label="排序" align="end" onClose={() => setAnchor(null)}>
      {(Object.keys(SORT_LABELS) as Array<keyof typeof SORT_LABELS>).map((value) => (
        <MenuItem key={value} label={SORT_LABELS[value]} checked={sortBy === value} onSelect={() => apply({ ...query, sortBy: value })} />
      ))}
      <MenuSeparator />
      <MenuItem label="从新到旧 / 从大到小" checked={direction === "desc"} onSelect={() => apply({ ...query, direction: "desc" })} />
      <MenuItem label="从旧到新 / 从小到大" checked={direction === "asc"} onSelect={() => apply({ ...query, direction: "asc" })} />
    </Popover>}
  </>;
}

export function FilterChips({ chips, query, normalSort, onQueryChange }: {
  chips: WorkFilterChip[];
  query: WorkQuery;
  normalSort: WorkSortSnapshot;
  onQueryChange: (query: WorkQuery) => void;
}) {
  if (!chips.length) return null;
  return <div className="work-filter-chips" aria-label="当前筛选">
    {chips.map((chip) => (
      <span className="ui-chip" key={chip.key}>
        {chip.label}
        <button type="button" aria-label={`移除筛选 ${chip.label}`} onClick={() => onQueryChange(chip.clear(query))}><Icon name="close" size={12} /></button>
      </span>
    ))}
    {chips.length > 1 && <button type="button" className="work-filter-clear" onClick={() => onQueryChange(clearAllWorkFilters(query, normalSort))}>全部清除</button>}
  </div>;
}
