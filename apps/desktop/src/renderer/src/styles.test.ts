import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rendererSourceDirectory = dirname(fileURLToPath(import.meta.url));
const stylesDirectory = join(rendererSourceDirectory, "styles");

describe("renderer style entry", () => {
  it("imports every style module exactly once and keeps the entry declarative", () => {
    const entry = readFileSync(join(rendererSourceDirectory, "styles.css"), "utf8");
    const imports = [...entry.matchAll(/@import "\.\/styles\/([^\"]+)";/g)].map(
      (match) => match[1],
    );
    const modules = readdirSync(stylesDirectory)
      .filter((fileName) => fileName.endsWith(".css"))
      .sort();

    expect(new Set(imports).size).toBe(imports.length);
    expect([...imports].sort()).toEqual(modules);
    expect(entry).not.toMatch(/[{}]/);

    const moduleSources = modules.map((moduleName) => ({
      moduleName,
      source: readFileSync(join(stylesDirectory, moduleName), "utf8"),
    }));
    for (const { moduleName, source } of moduleSources) {
      expect(source, `${moduleName} must not import another stylesheet`).not.toContain(
        "@import",
      );
    }

    const combinedSource = imports
      .map((moduleName) => moduleSources.find((module) => module.moduleName === moduleName)?.source ?? "")
      .join("");
    expect(combinedSource).toContain("content: '🖼️';");
    expect(combinedSource).toContain(
      "Saved Collection Views & Boolean Combinations (局部专属样式)",
    );
    expect(combinedSource).not.toMatch(/\uFFFD|馃|锔/);
  });
});
