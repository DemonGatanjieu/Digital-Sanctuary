import { describe, expect, it } from "vitest";
import { normalizeThemeRelativePath, parseStoreCatalog, parseThemeManifest, sanitizeThemeCss } from "./theme-manifest.js";

const validManifest = {
  id: "author.moonlight",
  name: "Moonlight",
  version: "1.2.3",
  author: "Artist",
  description: "A quiet blue theme",
  colorScheme: "dark",
};

describe("theme manifest boundary", () => {
  it("normalizes a portable manifest and never trusts isPreset", () => {
    expect(parseThemeManifest({ ...validManifest, tags: ["Anime", "anime"] }, false)).toEqual({
      ...validManifest,
      cssEntry: "theme.css",
      tags: ["anime"],
      isPreset: false,
    });
  });

  it("rejects traversal, executable CSS, and remote resource CSS", () => {
    expect(() => normalizeThemeRelativePath("../theme.css", [".css"])).toThrow("safe relative path");
    expect(() => parseThemeManifest({ ...validManifest, cssEntry: "C:\\theme.css" })).toThrow("safe relative path");
    expect(() => sanitizeThemeCss("@import 'https://example.com/theme.css';")).toThrow("external resources");
    expect(() => sanitizeThemeCss(".card { background: url(https://example.com/pixel); }")).toThrow("external resources");
    expect(sanitizeThemeCss(":root { --ds-primary: #7dd3fc; }")).toContain("--ds-primary");
  });

  it("validates store paths and HTTPS preview URLs", () => {
    expect(parseStoreCatalog({ themes: [{
      ...validManifest,
      tags: ["minimal"],
      previewImageUrl: "https://raw.githubusercontent.com/org/repo/main/themes/author.moonlight/preview.webp",
      downloadPath: "themes/author.moonlight",
      updatedAt: "2026-08-14T00:00:00.000Z",
    }] })).toHaveLength(1);
    expect(() => parseStoreCatalog([{ ...validManifest, previewImageUrl: "http://example.com/a.png", downloadPath: "../bad", updatedAt: "now" }])).toThrow();
  });
});
