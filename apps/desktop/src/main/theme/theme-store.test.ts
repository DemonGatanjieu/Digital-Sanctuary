import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeStoreService } from "./theme-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ThemeStoreService", () => {
  it("caches a GitHub catalog and falls back on rate limiting", async () => {
    const root = await mkdtemp(join(tmpdir(), "sanctuary-theme-store-"));
    roots.push(root);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(catalog(), 200, {
        etag: '"catalog-v1"',
        "x-ratelimit-remaining": "59",
        "x-ratelimit-reset": "2000000000",
      }))
      .mockResolvedValueOnce(jsonResponse({ message: "rate limited" }, 403, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "2000000000",
      }));
    const service = createService(root, fetchImpl, () => 1_000);
    const fresh = await service.fetchCatalog();
    expect(fresh.fromCache).toBe(false);
    expect(fresh.themes[0]?.installedVersion).toBe("0.9.0");
    const cached = await service.fetchCatalog(true);
    expect(cached.fromCache).toBe(true);
    expect(cached.rateLimitRemaining).toBe(0);
    expect(JSON.parse(await readFile(join(root, "cache.json"), "utf8"))).toMatchObject({
      etag: '"catalog-v1"',
      rateLimitRemaining: 0,
    });
  });

  it("uses persistent cache when the network later fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "sanctuary-theme-store-"));
    roots.push(root);
    const first = createService(root, vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(catalog())), () => 1_000);
    await first.fetchCatalog();
    const offline = createService(root, vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")), () => 2_000_000);
    await expect(offline.fetchCatalog(true)).resolves.toMatchObject({ fromCache: true });
  });

  it("downloads catalog-matched files and delegates atomic installation", async () => {
    const root = await mkdtemp(join(tmpdir(), "sanctuary-theme-store-"));
    roots.push(root);
    const installThemePackage = vi.fn(async (files) => ({
      ...(files.manifest as object),
      localPath: "installed",
      installedAt: 1,
      isActive: false,
    }));
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(catalog()))
      .mockResolvedValueOnce(jsonResponse(themeManifest()))
      .mockResolvedValueOnce(new Response(":root { --ds-primary: #38bdf8; }"));
    const service = new ThemeStoreService({
      manager: { getInstalledThemes: async () => [], installThemePackage: installThemePackage as never },
      cachePath: join(root, "cache.json"),
      fetchImpl,
      now: () => 1_000,
    });
    const progress: number[] = [];
    expect((await service.downloadAndInstallTheme("author.blue", (value) => progress.push(value))).id).toBe("author.blue");
    expect(progress).toEqual([5, 30, 75, 90, 100]);
    expect(installThemePackage).toHaveBeenCalledOnce();
  });
});

function createService(root: string, fetchImpl: typeof fetch, now: () => number): ThemeStoreService {
  return new ThemeStoreService({
    manager: {
      getInstalledThemes: async () => [{
        ...themeManifest(),
        version: "0.9.0",
        localPath: "installed",
        installedAt: 1,
        isActive: false,
      }],
      installThemePackage: async () => { throw new Error("not used"); },
    },
    cachePath: join(root, "cache.json"),
    fetchImpl,
    now,
  });
}

function catalog() {
  return { themes: [{
    ...themeManifest(),
    tags: ["blue"],
    previewImageUrl: "https://raw.githubusercontent.com/Digital-Sanctuary/digital-sanctuary-themes/main/themes/author.blue/preview.webp",
    downloadPath: "themes/author.blue",
    updatedAt: "2026-08-14T00:00:00.000Z",
  }] };
}

function themeManifest() {
  return {
    id: "author.blue",
    name: "Blue",
    version: "1.0.0",
    author: "Author",
    description: "Blue theme",
    colorScheme: "dark" as const,
  };
}

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
