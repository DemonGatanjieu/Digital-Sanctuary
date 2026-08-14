import { describe, expect, it } from "vitest";
import {
  DEFAULT_TYPOGRAPHY_PREFERENCES_V1,
  sanitizeCssFontFamily,
  validateTypographyPreferences
} from "./typography.js";

describe("Typography Domain Module", () => {
  it("provides valid default preferences", () => {
    const def = DEFAULT_TYPOGRAPHY_PREFERENCES_V1;
    expect(def.schemaVersion).toBe(1);
    expect(def.slots.body.source).toBe("preset");
    expect(def.slots.display.source).toBe("preset");
    expect(def.slots.editorial.source).toBe("preset");
    expect(def.slots.mono.source).toBe("preset");
  });

  it("safely parses and validates valid custom and system slots", () => {
    const valid = {
      schemaVersion: 1,
      slots: {
        body: { source: "custom", id: "font_f928a0" },
        display: { source: "system", family: "Microsoft YaHei", postscriptName: "MSYaHei" },
        editorial: { source: "preset", id: "preset.classical-editorial" },
        mono: { source: "preset", id: "preset.developer-mono" }
      },
      previewText: "Hello 幻想世界"
    };
    const validated = validateTypographyPreferences(valid);
    expect(validated.slots.body).toEqual({ source: "custom", id: "font_f928a0" });
    expect(validated.slots.display).toEqual({ source: "system", family: '"Microsoft YaHei"', postscriptName: "MSYaHei" });
    expect(validated.slots.editorial).toEqual({ source: "preset", id: "preset.classical-editorial" });
    expect(validated.previewText).toBe("Hello 幻想世界");
  });

  it("repairs corrupt or malicious preferences with fallbacks", () => {
    const corrupt = {
      slots: {
        body: { source: "custom", id: "../../../evil" }, // path traversal attempt
        display: { source: "system", family: '"><script>alert(1)</script>' },
        editorial: "invalid"
      },
      previewText: 12345
    };
    const repaired = validateTypographyPreferences(corrupt);
    expect(repaired.slots.body).toEqual(DEFAULT_TYPOGRAPHY_PREFERENCES_V1.slots.body);
    expect(repaired.slots.editorial).toEqual(DEFAULT_TYPOGRAPHY_PREFERENCES_V1.slots.editorial);
    expect(repaired.previewText).toBe(DEFAULT_TYPOGRAPHY_PREFERENCES_V1.previewText);
  });

  it("sanitizes CSS font family strings against injection", () => {
    expect(sanitizeCssFontFamily("Microsoft YaHei UI")).toBe('"Microsoft YaHei UI"');
    expect(sanitizeCssFontFamily("sans-serif")).toBe("sans-serif");
    expect(sanitizeCssFontFamily('evil; font-weight: bold; background: url("bad")')).toBe('"evil font-weight: bold background: url(bad)"');
  });
});
