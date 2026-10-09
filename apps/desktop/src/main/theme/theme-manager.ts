import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ActiveTheme, InstalledTheme, ThemeManifest } from "@sanctuary/domain";
import {
  MAX_THEME_MANIFEST_BYTES,
  MAX_THEME_PREVIEW_BYTES,
  MAX_THEME_ZIP_BYTES,
  normalizeThemeRelativePath,
  parseThemeManifest,
  sanitizeThemeCss,
} from "./theme-manifest.js";
import { extractThemeZip, selectThemePackageRoot } from "./theme-zip.js";

export interface ThemeManagerOptions {
  bundledThemesPath: string;
  userThemesPath: string;
  readActiveThemeId: () => string | null;
  writeActiveThemeId: (themeId: string) => void;
  now?: () => number;
}

export interface ThemePackageFiles {
  manifest: unknown;
  cssContent: string | Buffer;
  previewContent?: Buffer;
}

export class ThemeManagerService {
  readonly #bundledThemesPath: string;
  readonly #userThemesPath: string;
  readonly #readActiveThemeId: () => string | null;
  readonly #writeActiveThemeId: (themeId: string) => void;
  readonly #now: () => number;
  #installedCache: InstalledTheme[] | null = null;

  constructor(options: ThemeManagerOptions) {
    this.#bundledThemesPath = resolve(options.bundledThemesPath);
    this.#userThemesPath = resolve(options.userThemesPath);
    this.#readActiveThemeId = options.readActiveThemeId;
    this.#writeActiveThemeId = options.writeActiveThemeId;
    this.#now = options.now ?? Date.now;
  }

  async getInstalledThemes(): Promise<InstalledTheme[]> {
    if (!this.#installedCache) this.#installedCache = await this.#scanInstalledThemes();
    const requestedActiveId = this.#readActiveThemeId() ?? "default";
    const activeId = this.#installedCache.some((theme) => theme.id === requestedActiveId)
      ? requestedActiveId
      : "default";
    if (activeId !== requestedActiveId) this.#writeActiveThemeId(activeId);
    return this.#installedCache.map((theme) => ({ ...theme, isActive: theme.id === activeId }));
  }

  async getActiveTheme(): Promise<ActiveTheme> {
    const themes = await this.getInstalledThemes();
    const theme = themes.find((candidate) => candidate.isActive) ?? themes.find((candidate) => candidate.id === "default");
    if (!theme || theme.id === "default") return { themeId: "default", cssContent: "", ...(theme ? { manifest: toManifest(theme) } : {}) };
    return {
      themeId: theme.id,
      cssContent: await this.#readThemeCss(theme),
      manifest: toManifest(theme),
    };
  }

  async setActiveTheme(themeId: string): Promise<ActiveTheme> {
    const themes = await this.getInstalledThemes();
    const theme = themes.find((candidate) => candidate.id === themeId);
    if (!theme) throw new Error(`Theme ${themeId} is not installed`);
    const cssContent = theme.id === "default" ? "" : await this.#readThemeCss(theme);
    this.#writeActiveThemeId(theme.id);
    return { themeId: theme.id, cssContent, manifest: toManifest(theme) };
  }

  async installThemeFromFolder(folderPath: string): Promise<InstalledTheme> {
    const root = resolve(folderPath);
    const manifestBuffer = await readBoundedFile(join(root, "theme.json"), MAX_THEME_MANIFEST_BYTES, "Theme manifest");
    const rawManifest = parseJson(manifestBuffer, "Theme manifest");
    const manifest = await this.#completeManifestPreview(root, parseThemeManifest(rawManifest, false));
    const cssContent = await readBoundedFile(resolveInside(root, manifest.cssEntry ?? "theme.css"), 512 * 1024, "Theme CSS");
    const previewContent = manifest.previewImage
      ? await readBoundedFile(resolveInside(root, manifest.previewImage), MAX_THEME_PREVIEW_BYTES, "Theme preview")
      : undefined;
    return this.installThemePackage({ manifest, cssContent, ...(previewContent ? { previewContent } : {}) });
  }

  async installThemeFromZip(zipBuffer: Buffer): Promise<InstalledTheme> {
    if (zipBuffer.byteLength > MAX_THEME_ZIP_BYTES) throw new Error("Theme ZIP exceeds 20 MiB");
    const files = selectThemePackageRoot(extractThemeZip(zipBuffer));
    const manifestBuffer = files.get("theme.json");
    if (!manifestBuffer || manifestBuffer.byteLength > MAX_THEME_MANIFEST_BYTES) throw new Error("Theme ZIP has no valid theme.json");
    const manifest = parseThemeManifest(parseJson(manifestBuffer, "Theme manifest"), false);
    const cssContent = files.get(manifest.cssEntry ?? "theme.css");
    if (!cssContent) throw new Error("Theme ZIP is missing its CSS entry");
    const previewContent = manifest.previewImage ? files.get(manifest.previewImage) : undefined;
    if (manifest.previewImage && !previewContent) throw new Error("Theme ZIP is missing its preview image");
    return this.installThemePackage({ manifest, cssContent, ...(previewContent ? { previewContent } : {}) });
  }

  async installThemePackage(files: ThemePackageFiles): Promise<InstalledTheme> {
    const manifest = parseThemeManifest(files.manifest, false);
    const cssContent = sanitizeThemeCss(files.cssContent);
    if (files.previewContent) validatePreview(files.previewContent, manifest.previewImage);
    const installed = await this.getInstalledThemes();
    if (installed.some((theme) => theme.id === manifest.id && theme.isPreset)) {
      throw new Error(`Built-in theme ${manifest.id} cannot be replaced`);
    }
    await mkdir(this.#userThemesPath, { recursive: true });
    const stagingPath = join(this.#userThemesPath, `.install-${randomUUID()}`);
    const targetPath = join(this.#userThemesPath, manifest.id);
    const backupPath = join(this.#userThemesPath, `.backup-${manifest.id}-${randomUUID()}`);
    await mkdir(stagingPath, { recursive: true });
    try {
      await writeFile(join(stagingPath, "theme.json"), `${JSON.stringify({ ...manifest, isPreset: false }, null, 2)}\n`, "utf8");
      const cssPath = resolveInside(stagingPath, manifest.cssEntry ?? "theme.css");
      await mkdir(dirname(cssPath), { recursive: true });
      await writeFile(cssPath, cssContent, "utf8");
      if (manifest.previewImage && files.previewContent) {
        const previewPath = resolveInside(stagingPath, manifest.previewImage);
        await mkdir(dirname(previewPath), { recursive: true });
        await writeFile(previewPath, files.previewContent);
      }
      const hadExisting = existsSync(targetPath);
      if (hadExisting) await rename(targetPath, backupPath);
      try {
        await rename(stagingPath, targetPath);
      } catch (error) {
        if (hadExisting && existsSync(backupPath)) await rename(backupPath, targetPath);
        throw error;
      }
      if (hadExisting) await rm(backupPath, { recursive: true, force: true }).catch(() => undefined);
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true });
      throw error;
    }
    this.#installedCache = null;
    return this.#requireInstalledTheme(manifest.id);
  }

  async deleteTheme(themeId: string): Promise<boolean> {
    const themes = await this.getInstalledThemes();
    const theme = themes.find((candidate) => candidate.id === themeId);
    if (!theme || theme.isPreset) return false;
    const target = resolve(theme.localPath);
    if (!isInside(this.#userThemesPath, target)) throw new Error("Refusing to delete a theme outside user themes");
    await rm(target, { recursive: true, force: true });
    if ((this.#readActiveThemeId() ?? "default") === themeId) this.#writeActiveThemeId("default");
    this.#installedCache = null;
    return true;
  }

  invalidate(): void {
    this.#installedCache = null;
  }

  async #scanInstalledThemes(): Promise<InstalledTheme[]> {
    await mkdir(this.#userThemesPath, { recursive: true });
    const presets = await this.#scanRoot(this.#bundledThemesPath, true);
    const users = await this.#scanRoot(this.#userThemesPath, false);
    const byId = new Map<string, InstalledTheme>();
    for (const theme of presets) byId.set(theme.id, theme);
    for (const theme of users) if (!byId.has(theme.id)) byId.set(theme.id, theme);
    if (!byId.has("default")) {
      byId.set("default", {
        id: "default",
        name: "默认（跟随系统）",
        version: "2.0.0",
        author: "Digital Sanctuary Official",
        description: "中性配色，随系统切换浅色或深色。",
        colorScheme: "auto",
        tags: ["official", "default"],
        isPreset: true,
        localPath: join(this.#bundledThemesPath, "default"),
        installedAt: 0,
        isActive: false,
      });
    }
    return [...byId.values()].sort((left, right) => Number(right.isPreset) - Number(left.isPreset) || left.name.localeCompare(right.name));
  }

  async #scanRoot(root: string, preset: boolean): Promise<InstalledTheme[]> {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const themes = await Promise.all(entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map(async (entry) => {
      try {
        return await this.#loadInstalledTheme(join(root, entry.name), preset);
      } catch {
        return null;
      }
    }));
    return themes.filter((theme): theme is InstalledTheme => Boolean(theme));
  }

  async #loadInstalledTheme(root: string, preset: boolean): Promise<InstalledTheme> {
    const manifestBuffer = await readBoundedFile(join(root, "theme.json"), MAX_THEME_MANIFEST_BYTES, "Theme manifest");
    const manifest = await this.#completeManifestPreview(root, parseThemeManifest(parseJson(manifestBuffer, "Theme manifest"), preset));
    if (!(preset && manifest.id === "default" && !existsSync(resolveInside(root, manifest.cssEntry ?? "theme.css")))) {
      sanitizeThemeCss(await readBoundedFile(resolveInside(root, manifest.cssEntry ?? "theme.css"), 512 * 1024, "Theme CSS"));
    }
    if (manifest.previewImage) {
      const preview = await readBoundedFile(resolveInside(root, manifest.previewImage), MAX_THEME_PREVIEW_BYTES, "Theme preview");
      validatePreview(preview, manifest.previewImage);
    }
    const metadata = await stat(root);
    return {
      ...manifest,
      isPreset: preset,
      localPath: root,
      installedAt: metadata.birthtimeMs || metadata.mtimeMs || this.#now(),
      isActive: false,
    };
  }

  async #completeManifestPreview(root: string, manifest: ThemeManifest): Promise<ThemeManifest> {
    if (manifest.previewImage) return manifest;
    for (const candidate of ["preview.webp", "preview.png", "preview.jpg"]) {
      if (existsSync(join(root, candidate))) return { ...manifest, previewImage: candidate };
    }
    return manifest;
  }

  async #readThemeCss(theme: InstalledTheme): Promise<string> {
    const cssPath = resolveInside(theme.localPath, normalizeThemeRelativePath(theme.cssEntry ?? "theme.css", [".css"], "cssEntry"));
    return sanitizeThemeCss(await readBoundedFile(cssPath, 512 * 1024, "Theme CSS"));
  }

  async #requireInstalledTheme(themeId: string): Promise<InstalledTheme> {
    const installed = await this.getInstalledThemes();
    const theme = installed.find((candidate) => candidate.id === themeId);
    if (!theme) throw new Error("Installed theme could not be discovered");
    return theme;
  }
}

function toManifest(theme: InstalledTheme): ThemeManifest {
  const { localPath: _localPath, installedAt: _installedAt, isActive: _isActive, ...manifest } = theme;
  return manifest;
}

function resolveInside(root: string, relativePath: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relativePath);
  if (!isInside(resolvedRoot, target)) throw new Error("Theme path escapes its package directory");
  return target;
}

function isInside(root: string, target: string): boolean {
  const relation = relative(resolve(root), resolve(target));
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

async function readBoundedFile(path: string, maximumBytes: number, label: string): Promise<Buffer> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > maximumBytes) throw new Error(`${label} is missing or too large`);
  return readFile(path);
}

function parseJson(buffer: Buffer, label: string): unknown {
  if (buffer.includes(0)) throw new Error(`${label} is not valid JSON text`);
  try {
    return JSON.parse(buffer.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${label} contains invalid JSON`);
  }
}

function validatePreview(buffer: Buffer, path: string | undefined): void {
  if (!path) throw new Error("Theme preview bytes require previewImage in the manifest");
  if (buffer.byteLength > MAX_THEME_PREVIEW_BYTES) throw new Error("Theme preview exceeds 8 MiB");
  const extension = extname(path).toLowerCase();
  const valid = extension === ".png"
    ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === ".webp"
      ? buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP"
      : (extension === ".jpg" || extension === ".jpeg")
        ? buffer[0] === 0xff && buffer[1] === 0xd8
        : false;
  if (!valid) throw new Error("Theme preview content does not match its extension");
}
