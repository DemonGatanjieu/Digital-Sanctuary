import { dialog, ipcMain, type BrowserWindow } from "electron";
import {
  DEFAULT_TYPOGRAPHY_PREFERENCES_V1,
  validateTypographyPreferences,
  type TypographyFontDescriptor,
  type TypographyPreferencesV1
} from "@sanctuary/domain";
import type { LibraryDatabase } from "@sanctuary/database";
import type { FontService } from "./font-service.js";

const TYPOGRAPHY_PREFS_KEY = "typography.v1";

export function registerTypographyIpc(
  fontService: FontService,
  getDatabase: () => LibraryDatabase | undefined,
  getMainWindow: () => BrowserWindow | undefined
): void {
  ipcMain.handle("typography:list-fonts", async (): Promise<TypographyFontDescriptor[]> => {
    return fontService.listFonts();
  });

  ipcMain.handle("typography:import-dialog", async (): Promise<TypographyFontDescriptor | null> => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win ?? (undefined as unknown as BrowserWindow), {
      title: "导入本地字体文件",
      buttonLabel: "导入字体",
      properties: ["openFile"],
      filters: [
        { name: "字体文件 (*.ttf, *.otf)", extensions: ["ttf", "otf"] }
      ]
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    if (!filePath) return null;
    return fontService.importFont(filePath);
  });

  ipcMain.handle("typography:delete-font", async (_event, fontId: string): Promise<boolean> => {
    if (!fontId || typeof fontId !== "string") return false;
    return fontService.deleteFont(fontId.trim());
  });

  ipcMain.handle("typography:get-preferences", async (): Promise<TypographyPreferencesV1> => {
    const db = getDatabase();
    if (!db) return DEFAULT_TYPOGRAPHY_PREFERENCES_V1;

    try {
      const raw = db.getPreference<unknown>(TYPOGRAPHY_PREFS_KEY);
      if (!raw) return DEFAULT_TYPOGRAPHY_PREFERENCES_V1;
      return validateTypographyPreferences(raw);
    } catch {
      return DEFAULT_TYPOGRAPHY_PREFERENCES_V1;
    }
  });

  ipcMain.handle("typography:save-preferences", async (_event, input: unknown): Promise<TypographyPreferencesV1> => {
    const validated = validateTypographyPreferences(input);
    const db = getDatabase();
    if (db) {
      db.setPreference(TYPOGRAPHY_PREFS_KEY, validated);
    }
    return validated;
  });
}
