import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { Dialog, IpcMain } from "electron";
import type { ThemeChangedEvent, ThemeDownloadProgress } from "@sanctuary/domain";
import type { ThemeManagerService } from "./theme-manager.js";
import type { ThemeStoreService } from "./theme-store.js";
import { isThemeId, MAX_THEME_ZIP_BYTES } from "./theme-manifest.js";

interface ThemeIpcOptions {
  ipc: Pick<IpcMain, "handle">;
  dialog: Pick<Dialog, "showMessageBox" | "showOpenDialog">;
  manager: ThemeManagerService;
  store: ThemeStoreService;
  emitThemeChanged: (event: ThemeChangedEvent) => void;
  emitDownloadProgress: (event: ThemeDownloadProgress) => void;
}

export function registerThemeIpc(options: ThemeIpcOptions): void {
  const { ipc, dialog, manager, store, emitThemeChanged, emitDownloadProgress } = options;
  ipc.handle("themes:installed", () => manager.getInstalledThemes());
  ipc.handle("themes:active", () => manager.getActiveTheme());
  ipc.handle("themes:set-active", async (_event, value: unknown) => {
    const themeId = parseThemeId(value);
    const active = await manager.setActiveTheme(themeId);
    emitThemeChanged({ activeThemeId: active.themeId, cssContent: active.cssContent });
    return { success: true, cssContent: active.cssContent };
  });
  ipc.handle("themes:delete", async (_event, value: unknown) => {
    const themeId = parseThemeId(value);
    const deleted = await manager.deleteTheme(themeId);
    if (deleted) {
      const active = await manager.getActiveTheme();
      emitThemeChanged({ activeThemeId: active.themeId, cssContent: active.cssContent });
    }
    return deleted;
  });
  ipc.handle("themes:import", async () => {
    const choice = await dialog.showMessageBox({
      type: "question",
      title: "导入主题",
      message: "选择主题包来源",
      buttons: ["选择文件夹", "选择 ZIP", "取消"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice.response === 2) return null;
    const selection = await dialog.showOpenDialog(choice.response === 0
      ? { title: "选择包含 theme.json 的文件夹", properties: ["openDirectory"] }
      : { title: "选择主题 ZIP", properties: ["openFile"], filters: [{ name: "主题压缩包", extensions: ["zip"] }] });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || !selectedPath) return null;
    const installed = choice.response === 0
      ? await manager.installThemeFromFolder(selectedPath)
      : await installZipFile(manager, selectedPath);
    const active = await manager.getActiveTheme();
    emitThemeChanged({ activeThemeId: active.themeId, cssContent: active.cssContent });
    return installed;
  });
  ipc.handle("themes:store-catalog", (_event, forceRefresh: unknown) =>
    store.fetchCatalog(forceRefresh === true));
  ipc.handle("themes:store-install", async (_event, value: unknown) => {
    const themeId = parseThemeId(value);
    const installed = await store.downloadAndInstallTheme(themeId, (progress) => {
      emitDownloadProgress({ themeId, progress });
    });
    const active = await manager.getActiveTheme();
    emitThemeChanged({ activeThemeId: active.themeId, cssContent: active.cssContent });
    return installed;
  });
}

export function parseThemeId(value: unknown): string {
  if (!isThemeId(value)) throw new Error("Invalid theme id");
  return value;
}

async function installZipFile(manager: ThemeManagerService, path: string) {
  if (extname(path).toLowerCase() !== ".zip") throw new Error("Theme import requires a .zip file");
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_THEME_ZIP_BYTES) throw new Error("Theme ZIP is missing or too large");
  return manager.installThemeFromZip(await readFile(path));
}
