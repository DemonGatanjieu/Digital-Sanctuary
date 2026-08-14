/**
 * Typography System Domain Models & Contracts
 * Specification defined in TASK_TYPOGRAPHY_SYSTEM_AND_CUSTOM_FONTS_FOR_GEMINI.md
 */

export type TypographySlot = "body" | "display" | "editorial" | "mono";

export type TypographyFontRef =
  | { source: "preset"; id: string }
  | { source: "system"; postscriptName?: string; family: string }
  | { source: "custom"; id: string };

export interface TypographyPreferencesV1 {
  schemaVersion: 1;
  slots: Record<TypographySlot, TypographyFontRef>;
  previewText?: string;
}

export interface TypographyFontDescriptor {
  id: string;
  source: "preset" | "system" | "custom";
  family: string;
  fullName: string;
  postscriptName?: string;
  style: "normal" | "italic" | "oblique";
  weight?: number;
  variable: boolean;
  supportedSlots: TypographySlot[];
  status: "available" | "missing" | "invalid";
}

export const BUILTIN_TYPOGRAPHY_PRESETS: readonly TypographyFontDescriptor[] = [
  {
    id: "preset.system-ui",
    source: "preset",
    family: "Segoe UI Variable Text, Microsoft YaHei UI, sans-serif",
    fullName: "系统原生现代黑体 (System Modern UI)",
    style: "normal",
    variable: true,
    supportedSlots: ["body", "display"],
    status: "available"
  },
  {
    id: "preset.classical-editorial",
    source: "preset",
    family: "Songti SC, SimSun, Georgia, serif",
    fullName: "古典雅致宋体 (Classical Editorial)",
    style: "normal",
    variable: false,
    supportedSlots: ["editorial", "display"],
    status: "available"
  },
  {
    id: "preset.developer-mono",
    source: "preset",
    family: "Cascadia Mono, Consolas, monospace",
    fullName: "等宽终端字体 (Developer Monospace)",
    style: "normal",
    variable: false,
    supportedSlots: ["mono"],
    status: "available"
  }
] as const;

export const DEFAULT_TYPOGRAPHY_PREFERENCES_V1: TypographyPreferencesV1 = {
  schemaVersion: 1,
  slots: {
    body: { source: "preset", id: "preset.system-ui" },
    display: { source: "preset", id: "preset.system-ui" },
    editorial: { source: "preset", id: "preset.classical-editorial" },
    mono: { source: "preset", id: "preset.developer-mono" }
  },
  previewText: "二次元の幻想世界 · Digital Sanctuary 2026"
};

/**
 * Validates and repairs arbitrary input into a safe TypographyPreferencesV1 object.
 * Guarantee: never throws, never leaves missing slot, never accepts arbitrary CSS/path.
 */
export function validateTypographyPreferences(input: unknown): TypographyPreferencesV1 {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_TYPOGRAPHY_PREFERENCES_V1 };
  }

  const raw = input as Record<string, unknown>;
  const validSlots: TypographySlot[] = ["body", "display", "editorial", "mono"];
  const rawSlots = (raw.slots && typeof raw.slots === "object") ? (raw.slots as Record<string, unknown>) : {};

  const repairedSlots: Record<TypographySlot, TypographyFontRef> = { ...DEFAULT_TYPOGRAPHY_PREFERENCES_V1.slots };

  for (const slot of validSlots) {
    const candidate = rawSlots[slot];
    if (candidate && typeof candidate === "object") {
      const ref = candidate as Record<string, unknown>;
      if (ref.source === "preset" && typeof ref.id === "string" && ref.id.trim()) {
        repairedSlots[slot] = { source: "preset", id: ref.id.trim() };
      } else if (ref.source === "custom" && typeof ref.id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(ref.id.trim())) {
        repairedSlots[slot] = { source: "custom", id: ref.id.trim() };
      } else if (ref.source === "system" && typeof ref.family === "string" && ref.family.trim()) {
        repairedSlots[slot] = {
          source: "system",
          family: sanitizeCssFontFamily(ref.family.trim()),
          ...(typeof ref.postscriptName === "string" && ref.postscriptName.trim()
            ? { postscriptName: ref.postscriptName.trim() }
            : {})
        };
      }
    }
  }

  const previewText = (typeof raw.previewText === "string" && raw.previewText.length <= 200)
    ? raw.previewText
    : DEFAULT_TYPOGRAPHY_PREFERENCES_V1.previewText;

  const result: TypographyPreferencesV1 = {
    schemaVersion: 1,
    slots: repairedSlots
  };
  if (previewText) {
    result.previewText = previewText;
  }
  return result;
}

/**
 * Sanitizes a font family name to prevent CSS injection attacks (e.g. quotes, semicolons, braces).
 */
export function sanitizeCssFontFamily(family: string): string {
  // Remove control characters, semicolons, braces, quotes, backslashes
  const sanitized = family.replace(/[\u0000-\u001F\u007F-\u009F;{}"'\\]/g, "").replace(/\s+/g, " ").trim();
  // Wrap in quotes if it contains spaces or non-ascii characters and isn't a generic fallback
  const isGeneric = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(sanitized);
  if (!isGeneric && !/^"[^"]+"$/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, "")}"`;
  }
  return sanitized;
}
