import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import {
  DEFAULT_TYPOGRAPHY_PREFERENCES_V1,
  type TypographyFontDescriptor,
  type TypographyFontRef,
  type TypographyPreferencesV1,
  type TypographySlot
} from "@sanctuary/domain";
import {
  cleanupUnusedFontFaces,
  getInternalFontFamily,
  loadCustomFontFace
} from "./font-face-loader.js";

interface TypographyContextValue {
  preferences: TypographyPreferencesV1;
  fonts: TypographyFontDescriptor[];
  loading: boolean;
  updatePreferences: (draft: TypographyPreferencesV1) => Promise<void>;
  refreshFonts: () => Promise<void>;
  importFont: () => Promise<TypographyFontDescriptor | null>;
  deleteFont: (fontId: string) => Promise<boolean>;
}

const TypographyContext = createContext<TypographyContextValue | null>(null);

const DEFAULT_FALLBACK_STACKS: Record<TypographySlot, string> = {
  body: '"Segoe UI Variable Text", "Microsoft YaHei UI", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  display: '"Segoe UI Variable Text", "Microsoft YaHei UI", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  editorial: '"Songti SC", "SimSun", "Georgia", "Times New Roman", serif',
  mono: '"Cascadia Mono", "Consolas", "Courier New", monospace'
};

export const TypographyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preferences, setPreferences] = useState<TypographyPreferencesV1>(DEFAULT_TYPOGRAPHY_PREFERENCES_V1);
  const [fonts, setFonts] = useState<TypographyFontDescriptor[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshFonts = useCallback(async () => {
    if (!window.sanctuary?.listFonts) return;
    try {
      const list = await window.sanctuary.listFonts();
      setFonts(list);
    } catch {
      setFonts([]);
    }
  }, []);

  const loadPreferences = useCallback(async () => {
    if (!window.sanctuary?.getTypographyPreferences) return;
    try {
      const prefs = await window.sanctuary.getTypographyPreferences();
      setPreferences(prefs);
    } catch {
      setPreferences(DEFAULT_TYPOGRAPHY_PREFERENCES_V1);
    }
  }, []);

  useEffect(() => {
    Promise.all([refreshFonts(), loadPreferences()]).finally(() => setLoading(false));
  }, [refreshFonts, loadPreferences]);

  const updatePreferences = useCallback(async (draft: TypographyPreferencesV1) => {
    if (!window.sanctuary?.saveTypographyPreferences) return;
    try {
      const saved = await window.sanctuary.saveTypographyPreferences(draft);
      setPreferences(saved);
    } catch (err) {
      console.error("[typography] Failed to save preferences:", err);
    }
  }, []);

  const importFont = useCallback(async () => {
    if (!window.sanctuary?.importFontFromDialog) return null;
    try {
      const desc = await window.sanctuary.importFontFromDialog();
      if (desc) {
        await refreshFonts();
      }
      return desc;
    } catch (err) {
      console.error("[typography] Failed to import font:", err);
      return null;
    }
  }, [refreshFonts]);

  const deleteFont = useCallback(async (fontId: string) => {
    if (!window.sanctuary?.deleteFont) return false;
    try {
      const ok = await window.sanctuary.deleteFont(fontId);
      if (ok) {
        // If deleted font was in use, revert affected slot to default preset
        let needsSave = false;
        const newSlots = { ...preferences.slots };
        for (const slot of ["body", "display", "editorial", "mono"] as TypographySlot[]) {
          const currentRef = newSlots[slot];
          if (currentRef.source === "custom" && currentRef.id === fontId) {
            newSlots[slot] = DEFAULT_TYPOGRAPHY_PREFERENCES_V1.slots[slot];
            needsSave = true;
          }
        }
        if (needsSave) {
          await updatePreferences({ ...preferences, slots: newSlots });
        }
        await refreshFonts();
      }
      return ok;
    } catch (err) {
      console.error("[typography] Failed to delete font:", err);
      return false;
    }
  }, [preferences, updatePreferences, refreshFonts]);

  // Apply typography CSS variables & load custom FontFaces
  useEffect(() => {
    let cancelled = false;

    async function applyTypography() {
      const activeCustomIds = new Set<string>();
      const computedStacks: Record<TypographySlot, string> = { ...DEFAULT_FALLBACK_STACKS };

      for (const slot of ["body", "display", "editorial", "mono"] as TypographySlot[]) {
        const ref: TypographyFontRef = preferences.slots[slot] ?? DEFAULT_TYPOGRAPHY_PREFERENCES_V1.slots[slot];
        const fallback = DEFAULT_FALLBACK_STACKS[slot];

        if (ref.source === "custom") {
          activeCustomIds.add(ref.id);
          try {
            const internalFamily = await loadCustomFontFace(ref.id);
            computedStacks[slot] = `"${internalFamily}", ${fallback}`;
          } catch (err) {
            console.warn(`[typography] Failed to load custom font '${ref.id}', using fallback:`, err);
            computedStacks[slot] = fallback;
          }
        } else if (ref.source === "system") {
          const sanitizedFamily = ref.family.replace(/[;{}]/g, "").trim();
          computedStacks[slot] = `${sanitizedFamily}, ${fallback}`;
        } else if (ref.source === "preset") {
          const preset = fonts.find((f) => f.id === ref.id);
          if (preset) {
            computedStacks[slot] = `${preset.family}, ${fallback}`;
          } else {
            computedStacks[slot] = fallback;
          }
        }
      }

      if (cancelled) return;

      cleanupUnusedFontFaces(activeCustomIds);

      // Inject or update override style element
      let styleEl = document.getElementById("ds-typography-override") as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "ds-typography-override";
        document.head.appendChild(styleEl);
      }

      styleEl.textContent = `
:root {
  --ds-font-body: ${computedStacks.body};
  --ds-font-display: ${computedStacks.display};
  --ds-font-editorial: ${computedStacks.editorial};
  --ds-font-mono: ${computedStacks.mono};
}
      `.trim();
    }

    applyTypography();

    return () => {
      cancelled = true;
    };
  }, [preferences, fonts]);

  const value = useMemo(
    () => ({
      preferences,
      fonts,
      loading,
      updatePreferences,
      refreshFonts,
      importFont,
      deleteFont
    }),
    [preferences, fonts, loading, updatePreferences, refreshFonts, importFont, deleteFont]
  );

  return <TypographyContext.Provider value={value}>{children}</TypographyContext.Provider>;
};

export function useTypography(): TypographyContextValue {
  const ctx = useContext(TypographyContext);
  if (!ctx) {
    throw new Error("useTypography must be used within a TypographyProvider");
  }
  return ctx;
}
