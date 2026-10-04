import { randomUUID } from "node:crypto";
import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import type { SavedWorkFilter } from "@sanctuary/domain";
import { parseSavedWorkFilterDraft } from "../shared/saved-work-filter.js";
import { parseWorkId } from "../shared/library-query.js";

const KEY = "library.savedWorkFilters.v1";
export class SavedWorkFilterStore {
  constructor(private database: Pick<LibraryDatabase, "getPreference" | "setPreference">) {}
  list(): SavedWorkFilter[] {
    const value = this.database.getPreference<unknown>(KEY);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.slice(0, 30).flatMap((candidate): SavedWorkFilter[] => {
      const draft = parseSavedWorkFilterDraft(candidate);
      const id = candidate && typeof candidate === "object" ? parseWorkId(candidate.id) : null;
      const createdAt = candidate?.createdAt;
      if (!draft || !id || seen.has(id) || typeof createdAt !== "string" || createdAt.length > 40 || !Number.isFinite(Date.parse(createdAt))) return [];
      seen.add(id); return [{ ...draft, id, createdAt }];
    });
  }
  create(value: unknown): SavedWorkFilter {
    const draft = parseSavedWorkFilterDraft(value);
    if (!draft) throw new Error("请填写 80 字以内的筛选名称");
    const saved = this.list();
    if (saved.length >= 30) throw new Error("最多保存 30 个筛选，请先删除不常用的筛选");
    if (saved.some((item) => item.name === draft.name)) throw new Error("这个名称已存在，请换一个名称");
    const entry: SavedWorkFilter = { ...draft, id: randomUUID(), createdAt: new Date().toISOString() };
    this.database.setPreference(KEY, [...saved, entry]);
    return entry;
  }
  delete(value: unknown): boolean {
    const id = parseWorkId(value);
    if (!id) throw new Error("筛选记录无效");
    const saved = this.list();
    if (!saved.some((item) => item.id === id)) return false;
    this.database.setPreference(KEY, saved.filter((item) => item.id !== id));
    return true;
  }
}
export function registerSavedWorkFilterIpc(ipc: Pick<IpcMain, "handle">, database: LibraryDatabase) {
  const store = new SavedWorkFilterStore(database);
  ipc.handle("saved-work-filters:list", () => store.list());
  ipc.handle("saved-work-filters:create", (_event, value: unknown) => store.create(value));
  ipc.handle("saved-work-filters:delete", (_event, value: unknown) => store.delete(value));
}
