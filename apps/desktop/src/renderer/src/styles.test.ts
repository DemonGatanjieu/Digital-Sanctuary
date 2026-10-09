import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rendererSourceDirectory = dirname(fileURLToPath(import.meta.url));
const stylesDirectory = join(rendererSourceDirectory, "styles");

describe("renderer style entry", () => {
  const entry = readFileSync(join(rendererSourceDirectory, "styles.css"), "utf8");
  const order = entry.match(/^@layer ([\w\s,-]+);/m)?.[1]?.split(",").map((layer) => layer.trim()) ?? [];
  const imports = [...entry.matchAll(/@import "\.\/styles\/([^"]+)" layer\(([\w-]+)\);/g)].map(
    (match) => ({ name: match[1]!, layer: match[2]! }),
  );
  const modules = readdirSync(stylesDirectory).filter((fileName) => fileName.endsWith(".css")).sort();
  const source = (name: string) => readFileSync(join(stylesDirectory, name), "utf8");

  it("imports every style module exactly once into a declared layer", () => {
    expect(order).toEqual(["legacy", "foundation", "components", "views"]);
    expect(new Set(imports.map((item) => item.name)).size).toBe(imports.length);
    expect(imports.map((item) => item.name).sort()).toEqual(modules);
    expect(imports.every((item) => order.includes(item.layer))).toBe(true);
    expect(entry).not.toMatch(/[{}]/);
    // Every import line must use the layered form; a bare import would silently escape the cascade order.
    expect(entry.match(/@import/g)?.length).toBe(imports.length);
  });

  it("keeps modules self-contained and free of encoding damage", () => {
    for (const name of modules) {
      const css = source(name);
      expect(css, `${name} must not import another stylesheet`).not.toContain("@import");
      expect(css, `${name} has mojibake`).not.toMatch(/�|馃|锔/);
    }
  });

  it("forbids !important outside the legacy layer", () => {
    for (const { name, layer } of imports) {
      if (layer === "legacy") continue;
      expect(source(name), `${name} must not use !important`).not.toContain("!important");
    }
  });
});
