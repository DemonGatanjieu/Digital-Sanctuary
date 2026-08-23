import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ArtworkRecord } from "@sanctuary/domain";
import { ArtworkCard } from "./ArtworkCard.js";

function artwork(action: "allow" | "blur" | "hide" | null): ArtworkRecord {
  return {
    id: `art-${action ?? "none"}`,
    path: `E:\\gallery\\${action ?? "none"}.png`,
    fileName: `${action ?? "none"}.png`,
    importedAt: "2026-08-23T00:00:00.000Z",
    assessment: action ? {
      status: "complete",
      engine: "fixture",
      engineVersion: "1",
      labels: { unwanted: 0.9 },
      elapsedMs: 1
    } : null,
    decision: action ? {
      action,
      reasons: action === "allow" ? [] : [{
        ruleId: "fixture",
        ruleName: "fixture",
        label: "unwanted",
        confidence: 0.9,
        threshold: 0.5
      }],
      decidedAt: "2026-08-23T00:00:00.000Z"
    } : null,
    collectionIds: [],
    source: null
  };
}

describe("local gallery trust boundary", () => {
  it.each([null, "allow", "blur", "hide"] as const)(
    "always renders the local image clearly when the stored decision is %s",
    (action) => {
      const markup = renderToStaticMarkup(
        <ArtworkCard
          artwork={artwork(action)}
          collections={[]}
          onAssign={() => undefined}
          onOpen={() => undefined}
        />
      );
      expect(markup).toContain("<img");
      expect(markup).not.toContain("blurred");
      expect(markup).not.toContain("内容已隐藏");
      expect(markup).not.toContain("decision-badge");
    }
  );

  it("keeps every gallery presentation surface independent from filter actions", () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    for (const fileName of ["ArtworkLightbox.tsx", "AuthorGallery.tsx", "AquariumFloatingStage.tsx"]) {
      const source = readFileSync(join(directory, fileName), "utf8");
      expect(source, fileName).not.toMatch(/decision\?\.action|action === ["'](?:blur|hide)["']/);
    }
  });

  it("never makes the full-size local image transparent while load state settles", () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const component = readFileSync(join(directory, "ArtworkLightbox.tsx"), "utf8");
    const styles = readFileSync(join(directory, "styles", "lightbox.css"), "utf8");
    expect(component).toContain('className="cinema-image-entity"');
    expect(component).not.toMatch(/cinema-image-entity.*(?:loading|blurred)/);
    expect(styles).not.toMatch(/\.cinema-image-entity\.loading\s*\{[^}]*opacity:\s*0/s);
  });
});
