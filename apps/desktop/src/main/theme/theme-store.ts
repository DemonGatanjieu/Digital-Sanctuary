import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  InstalledTheme,
  StoreCatalogResponse,
  StoreThemeItem,
} from "@sanctuary/domain";
import type { ThemeManagerService, ThemePackageFiles } from "./theme-manager.js";
import {
  MAX_THEME_CSS_BYTES,
  MAX_THEME_MANIFEST_BYTES,
  MAX_THEME_PREVIEW_BYTES,
  parseStoreCatalog,
  parseThemeManifest,
} from "./theme-manifest.js";

const CATALOG_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 15_000;

interface ThemeStoreCache {
  themes: StoreThemeItem[];
  fetchedAt: number;
  etag: string;
  rateLimitRemaining: number;
  rateLimitResetAt: number;
}

export interface ThemeStoreOptions {
  manager: Pick<ThemeManagerService, "getInstalledThemes" | "installThemePackage">;
  cachePath: string;
  owner?: string;
  repository?: string;
  ref?: string;
  catalogPath?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  githubToken?: string;
}

export class ThemeStoreService {
  readonly #manager: ThemeStoreOptions["manager"];
  readonly #cachePath: string;
  readonly #owner: string;
  readonly #repository: string;
  readonly #ref: string;
  readonly #catalogPath: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #githubToken: string;
  #cache: ThemeStoreCache | null | undefined;

  constructor(options: ThemeStoreOptions) {
    this.#manager = options.manager;
    this.#cachePath = options.cachePath;
    this.#owner = options.owner ?? "Digital-Sanctuary";
    this.#repository = options.repository ?? "digital-sanctuary-themes";
    this.#ref = options.ref ?? "main";
    this.#catalogPath = options.catalogPath ?? "manifest.json";
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#githubToken = options.githubToken?.trim() ?? "";
  }

  async fetchCatalog(forceRefresh = false): Promise<StoreCatalogResponse> {
    const cache = await this.#loadCache();
    if (!forceRefresh && cache && this.#now() - cache.fetchedAt < CATALOG_TTL_MS) {
      return this.#decorateCatalog(cache, true);
    }
    if (cache && cache.rateLimitRemaining <= 1 && cache.rateLimitResetAt > this.#now()) {
      return this.#decorateCatalog(cache, true);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(this.#catalogApiUrl(), {
        headers: {
          Accept: "application/vnd.github.raw+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Digital-Sanctuary/0.1.0",
          ...(this.#githubToken ? { Authorization: `Bearer ${this.#githubToken}` } : {}),
          ...(cache?.etag ? { "If-None-Match": cache.etag } : {}),
        },
        signal: controller.signal,
      });
      const rateLimitRemaining = parseHeaderInteger(response.headers.get("x-ratelimit-remaining"), cache?.rateLimitRemaining ?? 60);
      const rateLimitResetAt = parseHeaderInteger(
        response.headers.get("x-ratelimit-reset"),
        Math.floor((cache?.rateLimitResetAt ?? 0) / 1_000),
      ) * 1_000;
      if (response.status === 304 && cache) {
        const refreshed = { ...cache, fetchedAt: this.#now(), rateLimitRemaining, rateLimitResetAt };
        await this.#saveCache(refreshed);
        return this.#decorateCatalog(refreshed, true);
      }
      if ((response.status === 403 || response.status === 429) && cache) {
        const limited = { ...cache, rateLimitRemaining, rateLimitResetAt };
        await this.#saveCache(limited);
        return this.#decorateCatalog(limited, true);
      }
      if (!response.ok) throw new Error(`GitHub theme catalog returned HTTP ${response.status}`);
      const bytes = await readResponseBuffer(response, 2 * 1024 * 1024);
      const themes = parseStoreCatalog(JSON.parse(bytes.toString("utf8")) as unknown);
      const next: ThemeStoreCache = {
        themes,
        fetchedAt: this.#now(),
        etag: response.headers.get("etag") ?? "",
        rateLimitRemaining,
        rateLimitResetAt,
      };
      await this.#saveCache(next);
      return this.#decorateCatalog(next, false);
    } catch (error) {
      if (cache) return this.#decorateCatalog(cache, true);
      if (error instanceof Error && error.name === "AbortError") throw new Error("Theme store request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async downloadAndInstallTheme(
    themeId: string,
    onProgress?: (progress: number) => void,
  ): Promise<InstalledTheme> {
    const catalog = await this.fetchCatalog(false);
    const item = catalog.themes.find((theme) => theme.id === themeId);
    if (!item) throw new Error(`Theme ${themeId} is not available in the configured store`);
    onProgress?.(5);
    const basePath = repositoryPath(item.downloadPath);
    const manifestBytes = await this.#fetchRaw(`${basePath}/theme.json`, MAX_THEME_MANIFEST_BYTES);
    const manifest = parseThemeManifest(JSON.parse(manifestBytes.toString("utf8")) as unknown, false);
    if (manifest.id !== item.id || manifest.version !== item.version) {
      throw new Error("Downloaded theme manifest does not match the store catalog");
    }
    onProgress?.(30);
    const cssContent = await this.#fetchRaw(
      `${basePath}/${repositoryPath(manifest.cssEntry ?? "theme.css")}`,
      MAX_THEME_CSS_BYTES,
    );
    onProgress?.(75);
    const previewContent = manifest.previewImage
      ? await this.#fetchRaw(`${basePath}/${repositoryPath(manifest.previewImage)}`, MAX_THEME_PREVIEW_BYTES)
      : undefined;
    onProgress?.(90);
    const files: ThemePackageFiles = {
      manifest,
      cssContent,
      ...(previewContent ? { previewContent } : {}),
    };
    const installed = await this.#manager.installThemePackage(files);
    onProgress?.(100);
    return installed;
  }

  async #decorateCatalog(cache: ThemeStoreCache, fromCache: boolean): Promise<StoreCatalogResponse> {
    const installedVersions = new Map(
      (await this.#manager.getInstalledThemes()).map((theme) => [theme.id, theme.version]),
    );
    return {
      themes: cache.themes.map((theme) => {
        const installedVersion = installedVersions.get(theme.id);
        return { ...theme, ...(installedVersion ? { installedVersion } : {}) };
      }),
      fetchedAt: cache.fetchedAt,
      fromCache,
      rateLimitRemaining: cache.rateLimitRemaining,
      rateLimitResetAt: cache.rateLimitResetAt,
    };
  }

  async #loadCache(): Promise<ThemeStoreCache | null> {
    if (this.#cache !== undefined) return this.#cache;
    try {
      const raw = JSON.parse(await readFile(this.#cachePath, "utf8")) as Partial<ThemeStoreCache>;
      if (
        !Array.isArray(raw.themes) ||
        typeof raw.fetchedAt !== "number" ||
        typeof raw.etag !== "string" ||
        typeof raw.rateLimitRemaining !== "number" ||
        typeof raw.rateLimitResetAt !== "number"
      ) throw new Error("Invalid theme store cache");
      this.#cache = {
        themes: parseStoreCatalog(raw.themes),
        fetchedAt: raw.fetchedAt,
        etag: raw.etag,
        rateLimitRemaining: raw.rateLimitRemaining,
        rateLimitResetAt: raw.rateLimitResetAt,
      };
    } catch {
      this.#cache = null;
    }
    return this.#cache;
  }

  async #saveCache(cache: ThemeStoreCache): Promise<void> {
    this.#cache = cache;
    try {
      await mkdir(dirname(this.#cachePath), { recursive: true });
      const temporaryPath = `${this.#cachePath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(cache)}\n`, "utf8");
      await rename(temporaryPath, this.#cachePath);
    } catch {
      // A read-only or temporarily unavailable cache directory must not make
      // a successfully fetched catalog unusable for the current process.
    }
  }

  #catalogApiUrl(): string {
    const path = this.#catalogPath.split("/").map(encodeURIComponent).join("/");
    return `https://api.github.com/repos/${encodeURIComponent(this.#owner)}/${encodeURIComponent(this.#repository)}/contents/${path}?ref=${encodeURIComponent(this.#ref)}`;
  }

  async #fetchRaw(path: string, maximumBytes: number): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(this.#contentApiUrl(path), {
        headers: {
          Accept: "application/vnd.github.raw+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Digital-Sanctuary/0.1.0",
          ...(this.#githubToken ? { Authorization: `Bearer ${this.#githubToken}` } : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Theme download returned HTTP ${response.status}`);
      return await readResponseBuffer(response, maximumBytes);
    } finally {
      clearTimeout(timer);
    }
  }

  #contentApiUrl(path: string): string {
    return `https://api.github.com/repos/${encodeURIComponent(this.#owner)}/${encodeURIComponent(this.#repository)}/contents/${path}?ref=${encodeURIComponent(this.#ref)}`;
  }
}

async function readResponseBuffer(response: Response, maximumBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error("Theme store response is too large");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("Theme store response is too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function repositoryPath(value: string): string {
  const path = value.replaceAll("\\", "/");
  if (
    path.startsWith("/") ||
    path.includes(":") ||
    path.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) throw new Error("Theme store path is unsafe");
  return path.split("/").map(encodeURIComponent).join("/");
}

function parseHeaderInteger(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
