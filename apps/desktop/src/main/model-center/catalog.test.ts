import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "./catalog.js";

describe("model center catalog", () => {
  it("pins Gemma downloads to immutable revisions and verified files", () => {
    const gemmaModels = MODEL_CATALOG.filter((entry) => entry.id.startsWith("gemma-4-"));
    expect(gemmaModels.map((entry) => entry.id)).toEqual([
      "gemma-4-e2b-it-q4",
      "gemma-4-e4b-it-q4"
    ]);

    for (const model of gemmaModels) {
      expect(model).toMatchObject({
        capability: "art_critic",
        runtime: "llama_cpp_vlm",
        availability: "ready",
        license: "Apache-2.0"
      });
      expect(model.files.some((file) => file.fileName.startsWith("mmproj-") && file.fileName.endsWith(".gguf"))).toBe(true);
      expect(model.files.some((file) => file.fileName.endsWith(".gguf") && !file.fileName.startsWith("mmproj-"))).toBe(true);
      for (const file of model.files) {
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(file.size).toBeGreaterThan(0);
        if (file.url.includes("huggingface.co")) {
          expect(file.url).toMatch(/\/resolve\/[a-f0-9]{40}\//);
          expect(file.url).not.toContain("/resolve/main/");
        }
      }
      expect(model.downloadSize).toBe(model.files.reduce((total, file) => total + file.size, 0));
    }
  });
});
