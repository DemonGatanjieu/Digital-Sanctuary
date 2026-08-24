import { describe, expect, it } from "vitest";
import {
  applyPromptPreset,
  composePromptPreview,
  createPromptPreset,
  defaultPromptTagRole,
  normalizePromptWorkspace
} from "./prompt-bridge.js";

describe("prompt bridge", () => {
  it("uses confidence for candidate selection rather than generation weights", () => {
    const workspace = normalizePromptWorkspace({
      modelProfile: "sdxl-illustration",
      negativeLibrary: ["low quality", "watermark"]
    });
    const preview = composePromptPreview(
      { solo: 0.95, cat_ears: 0.82, blood: 0.66, uncertain_detail: 0.24, noise: 0.1 },
      workspace,
      0.2,
      { blood: "negative", solo: "ignored" }
    );
    expect(preview.rawTags).toContain("uncertain_detail");
    expect(preview.positivePrompt).toBe("cat ears");
    expect(preview.positivePrompt).not.toContain("0.82");
    expect(preview.negativePrompt).toBe("blood, low quality, watermark");
    expect(preview.ignoredTags).toEqual(["solo", "uncertain_detail"]);
  });

  it("defaults strong evidence to positive and uncertain evidence to ignored", () => {
    expect(defaultPromptTagRole(0.4)).toBe("positive");
    expect(defaultPromptTagRole(0.399)).toBe("ignored");
  });

  it("migrates old accumulated tag data without carrying it into the new workspace", () => {
    const workspace = normalizePromptWorkspace({
      version: 1,
      modelProfile: "unknown",
      dispositions: { " Cat Ears ": "favorite", blood: "avoid" },
      negativeLibrary: [" watermark ", "watermark", 42],
      presets: [{
        id: "legacy",
        name: "旧预设",
        modelProfile: "danbooru",
        dispositions: { cat_ears: "favorite" },
        negativeLibrary: ["bad anatomy"],
        createdAt: "2026-08-24T00:00:00.000Z"
      }]
    });
    expect(workspace).toEqual({
      version: 2,
      modelProfile: "danbooru",
      negativeLibrary: ["watermark"],
      presets: [{
        id: "legacy",
        name: "旧预设",
        modelProfile: "danbooru",
        negativeLibrary: ["bad anatomy"],
        createdAt: "2026-08-24T00:00:00.000Z"
      }]
    });
  });

  it("saves only reusable formatting in presets", () => {
    const workspace = normalizePromptWorkspace({ modelProfile: "flux-natural", negativeLibrary: ["watermark"] });
    const preset = createPromptPreset("自然语言", workspace, "preset-1", "2026-08-24T00:00:00.000Z");
    expect(applyPromptPreset(normalizePromptWorkspace(null), preset)).toMatchObject({
      modelProfile: "flux-natural",
      negativeLibrary: ["watermark"]
    });
    expect(preset).not.toHaveProperty("dispositions");
  });

  it("uses concise natural language for FLUX without weight syntax", () => {
    const workspace = normalizePromptWorkspace({ modelProfile: "flux-natural" });
    const preview = composePromptPreview({ blue_hair: 0.8, cityscape: 0.6 }, workspace);
    expect(preview.positivePrompt).toBe("An illustration featuring blue hair, cityscape.");
    expect(preview.positivePrompt).not.toContain("1.15");
  });
});
