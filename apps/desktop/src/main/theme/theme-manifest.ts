import type {
  StoreThemeItem,
  ThemeColorScheme,
  ThemeManifest,
} from "@sanctuary/domain";

export const MAX_THEME_CSS_BYTES = 512 * 1024;
export const MAX_THEME_MANIFEST_BYTES = 64 * 1024;
export const MAX_THEME_PREVIEW_BYTES = 8 * 1024 * 1024;
export const MAX_THEME_ZIP_BYTES = 20 * 1024 * 1024;

const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const STORE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const UNSAFE_CSS_PATTERN = /@import\b|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:|javascript\s*:|<\/style/iu;

export function parseThemeManifest(value: unknown, preset = false): ThemeManifest {
  if (!isRecord(value)) throw new Error("Theme manifest must be an object");
  const id = requiredString(value.id, "id", 80);
  if (!THEME_ID_PATTERN.test(id)) {
    throw new Error("Theme id may contain only lowercase letters, numbers, dots, underscores, and hyphens");
  }
  const version = requiredString(value.version, "version", 64);
  if (!VERSION_PATTERN.test(version)) throw new Error("Theme version must use semantic versioning");
  const authorUrl = optionalHttpsUrl(value.authorUrl, "authorUrl");
  const cssEntry = value.cssEntry === undefined
    ? "theme.css"
    : normalizeThemeRelativePath(value.cssEntry, [".css"], "cssEntry");
  const previewImage = value.previewImage === undefined
    ? undefined
    : normalizeThemeRelativePath(value.previewImage, [".png", ".webp", ".jpg", ".jpeg"], "previewImage");
  return {
    id,
    name: requiredString(value.name, "name", 120),
    version,
    author: requiredString(value.author, "author", 120),
    ...(authorUrl ? { authorUrl } : {}),
    description: requiredString(value.description, "description", 1_000),
    colorScheme: parseColorScheme(value.colorScheme),
    cssEntry,
    ...(previewImage ? { previewImage } : {}),
    tags: parseTags(value.tags),
    ...(value.minAppVersion === undefined
      ? {}
      : { minAppVersion: requiredString(value.minAppVersion, "minAppVersion", 64) }),
    isPreset: preset,
  };
}

export function sanitizeThemeCss(value: string | Buffer): string {
  const bytes = typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
  if (bytes > MAX_THEME_CSS_BYTES) throw new Error("Theme CSS exceeds 512 KiB");
  const css = typeof value === "string" ? value : value.toString("utf8");
  if (css.includes("\uFFFD") || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(css)) {
    throw new Error("Theme CSS is not valid text");
  }
  if (UNSAFE_CSS_PATTERN.test(css)) {
    throw new Error("Theme CSS contains external resources or executable legacy syntax");
  }
  return css;
}

export function normalizeThemeRelativePath(
  value: unknown,
  extensions: string[],
  fieldName = "path",
): string {
  const path = requiredString(value, fieldName, 240).replaceAll("\\", "/");
  if (
    path.startsWith("/") ||
    path.includes(":") ||
    path.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Theme ${fieldName} must be a safe relative path`);
  }
  const lower = path.toLowerCase();
  if (!extensions.some((extension) => lower.endsWith(extension))) {
    throw new Error(`Theme ${fieldName} has an unsupported extension`);
  }
  return path;
}

export function parseStoreCatalog(value: unknown): StoreThemeItem[] {
  const rawItems = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.themes)
      ? value.themes
      : null;
  if (!rawItems || rawItems.length > 500) throw new Error("Theme store catalog is invalid");
  const ids = new Set<string>();
  return rawItems.map((rawItem) => {
    if (!isRecord(rawItem)) throw new Error("Theme store item must be an object");
    const manifest = parseThemeManifest(rawItem, false);
    if (ids.has(manifest.id)) throw new Error(`Theme store contains duplicate id ${manifest.id}`);
    ids.add(manifest.id);
    const previewImageUrl = requiredHttpsUrl(rawItem.previewImageUrl, "previewImageUrl");
    const downloadPath = requiredString(rawItem.downloadPath, "downloadPath", 240).replaceAll("\\", "/");
    if (
      !STORE_PATH_PATTERN.test(downloadPath) ||
      downloadPath.startsWith("/") ||
      downloadPath.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) throw new Error("Theme store downloadPath must be a safe repository-relative path");
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      ...(manifest.authorUrl ? { authorUrl: manifest.authorUrl } : {}),
      description: manifest.description,
      colorScheme: manifest.colorScheme,
      tags: manifest.tags ?? [],
      previewImageUrl,
      downloadPath,
      ...(typeof rawItem.stars === "number" && Number.isSafeInteger(rawItem.stars) && rawItem.stars >= 0
        ? { stars: rawItem.stars }
        : {}),
      updatedAt: requiredIsoDate(rawItem.updatedAt, "updatedAt"),
    };
  });
}

export function isThemeId(value: unknown): value is string {
  return typeof value === "string" && THEME_ID_PATTERN.test(value);
}

function parseColorScheme(value: unknown): ThemeColorScheme {
  if (value === "dark" || value === "light" || value === "auto") return value;
  throw new Error("Theme colorScheme must be dark, light, or auto");
}

function parseTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("Theme tags must be an array of at most 20 items");
  const tags = value.map((tag) => requiredString(tag, "tag", 40).toLowerCase());
  return [...new Set(tags)];
}

function optionalHttpsUrl(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredHttpsUrl(value, fieldName);
}

function requiredHttpsUrl(value: unknown, fieldName: string): string {
  const text = requiredString(value, fieldName, 500);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`Theme ${fieldName} must be a valid URL`);
  }
  if (url.protocol !== "https:") throw new Error(`Theme ${fieldName} must use HTTPS`);
  return url.toString();
}

function requiredIsoDate(value: unknown, fieldName: string): string {
  const text = requiredString(value, fieldName, 64);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`Theme ${fieldName} must be an ISO date`);
  return text;
}

function requiredString(value: unknown, fieldName: string, maximumLength: number): string {
  if (typeof value !== "string") throw new Error(`Theme ${fieldName} must be a string`);
  const text = value.trim();
  if (!text || text.length > maximumLength) {
    throw new Error(`Theme ${fieldName} must contain 1 to ${maximumLength} characters`);
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
