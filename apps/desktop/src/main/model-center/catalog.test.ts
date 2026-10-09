import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, SEMANTIC_MODEL_ID } from "./catalog.js";
import { modelFileSegments } from "./model-center-service.js";

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

  it("installs picture search as the pinned 15-file snapshot plus one verified runtime pack", () => {
    const model = MODEL_CATALOG.find((entry) => entry.id === SEMANTIC_MODEL_ID)!;
    expect(model).toMatchObject({ capability: "semantic_embedding", runtime: "semantic_runtime", availability: "ready", license: "Apache-2.0" });
    const snapshot = model.files.filter((file) => !file.extract);
    const runtime = model.files.filter((file) => file.extract === "zip");
    // services/semantic/server.py refuses to start unless the manifest lists exactly these 15 files.
    expect(snapshot).toHaveLength(15);
    expect(snapshot.map((file) => file.fileName)).toContain("1_Pooling/config.json");
    for (const file of snapshot) {
      expect(file.url).toBe(`https://huggingface.co/google/embeddinggemma-2/resolve/${model.snapshot!.revision}/${file.fileName}`);
      expect(modelFileSegments(file.fileName).length).toBeGreaterThan(0);
    }
    expect(runtime).toHaveLength(1);
    expect(runtime[0]!.url).toMatch(/^https:\/\/github\.com\/.+\/releases\/download\//);
    for (const file of model.files) expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(model.requiredRuntimeFiles).toEqual(["sanctuary-semantic/sanctuary-semantic.exe"]);
    expect(model.downloadSize).toBe(model.files.reduce((total, file) => total + file.size, 0));
  });

  it("refuses catalog file names that could leave the model folder", () => {
    for (const name of ["../x", "a/../../x", "./x", "a\\b", "", "C:x/y", "a/b/c/d/e"]) expect(() => modelFileSegments(name)).toThrow("不安全");
    expect(modelFileSegments(".gitattributes")).toEqual([".gitattributes"]);
  });
});
