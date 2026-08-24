import { describe, expect, it } from "vitest";
import {
  applyPromptPreset,
  composePromptPreview,
  createPromptPreset,
  normalizePromptWorkspace
} from "./prompt-bridge.js";

describe("prompt bridge", () => {
  it("composes model-adapted positive and negative prompts", () => {
    const workspace = normalizePromptWorkspace({
      modelProfile: "sdxl-illustration",
      dispositions: { cat_ears: "favorite", blood: "avoid", solo: "neutral" },
      negativeLibrary: ["low quality", "watermark"]
    });
    const preview = composePromptPreview({ solo: 0.95, cat_ears: 0.82, blood: 0.66, noise: 0.1 }, workspace);
    expect(preview.rawTags).toContain("blood");
    expect(preview.positivePrompt).toContain("(cat ears:1.15)");
    expect(preview.positivePrompt).not.toContain("blood");
    expect(preview.negativePrompt).toBe("blood, low quality, watermark");
  });

  it("normalizes damaged data and applies a local preset", () => {
    const workspace = normalizePromptWorkspace({
      modelProfile: "unknown",
      dispositions: { " Cat Ears ": "favorite", nope: "invalid" },
      negativeLibrary: [" watermark ", "watermark", 42]
    });
    expect(workspace).toMatchObject({
      modelProfile: "danbooru",
      dispositions: { cat_ears: "favorite" },
      negativeLibrary: ["watermark"]
    });
    const preset = createPromptPreset("猫系", workspace, "preset-1", "2026-08-24T00:00:00.000Z");
    expect(applyPromptPreset({ ...workspace, dispositions: {} }, preset).dispositions).toEqual({ cat_ears: "favorite" });
  });

  it("uses concise natural language for FLUX without weight syntax", () => {
    const workspace = normalizePromptWorkspace({
      modelProfile: "flux-natural",
      dispositions: { blue_hair: "favorite" }
    });
    const preview = composePromptPreview({ blue_hair: 0.8, cityscape: 0.6 }, workspace);
    expect(preview.positivePrompt).toBe("An illustration featuring blue hair, cityscape.");
    expect(preview.positivePrompt).not.toContain("1.15");
  });
});
