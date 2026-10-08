import type { DatabaseSync } from "node:sqlite";

/** Local display names are independent of source metadata and physical file names. */
export class WorkNameStore {
  constructor(private readonly database: DatabaseSync) {}

  ensureSchema(): void {
    const columns = this.database.prepare("PRAGMA table_info(works)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "custom_title")) {
      this.database.exec("ALTER TABLE works ADD COLUMN custom_title TEXT");
    }
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (7, ?)").run(new Date().toISOString());
  }

  rename(workId: string, value: string): void {
    if (typeof value !== "string") throw new Error("请填写图库名称");
    const name = value.trim();
    if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("图库名称需要 1–200 个字符，不能包含换行或控制字符");
    const result = this.database.prepare("UPDATE works SET title = ?, custom_title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(name, name, new Date().toISOString(), workId);
    if (!result.changes) throw new Error("作品已从图库移除，请刷新后重试");
  }
}
