import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelCapability, ModelCatalogEntry } from "@sanctuary/domain";
import { ModelCenterService } from "./model-center-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ModelCenterService", () => {
  it("recognizes bundled models, installs verified files, activates and removes safely", async () => {
    const root = await mkdtemp(join(tmpdir(), "sanctuary-model-center-"));
    roots.push(root);
    const bundled = join(root, "bundled");
    const modelsRoot = join(root, "models");
    await mkdir(bundled, { recursive: true });
    await writeFile(join(bundled, "model.onnx"), "builtin");
    await writeFile(join(bundled, "selected_tags.csv"), "tags");

    const payload = Buffer.from("verified model payload");
    const tags = Buffer.from("verified tags");
    const catalog = [
      entry("builtin", [
        file("model.onnx", "https://example.test/builtin.onnx", Buffer.from("builtin")),
        file("selected_tags.csv", "https://example.test/builtin.csv", Buffer.from("tags"))
      ], "balanced"),
      entry("downloadable", [
        file("model.onnx", "https://example.test/model.onnx", payload),
        file("selected_tags.csv", "https://example.test/selected_tags.csv", tags)
      ], "advanced")
    ];
    const preferences = new Map<ModelCapability, string>();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value = String(url).endsWith("selected_tags.csv") ? tags : payload;
      return new Response(value, { status: 200 });
    }) as typeof fetch;
    const service = new ModelCenterService({
      modelsRoot,
      bundledModels: { builtin: bundled },
      readActiveModelId: (capability) => preferences.get(capability) ?? null,
      writeActiveModelId: (capability, modelId) => { preferences.set(capability, modelId); },
      catalog,
      fetchImpl
    });

    let snapshot = await service.snapshot();
    expect(snapshot.models.find((model) => model.id === "builtin")).toMatchObject({ bundled: true, active: true });
    expect(snapshot.models.find((model) => model.id === "downloadable")?.installed).toBe(false);

    snapshot = await service.install("downloadable");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(snapshot.models.find((model) => model.id === "downloadable")?.installed).toBe(true);

    await service.activate("downloadable");
    expect((await service.snapshot()).activeByCapability.element_tagging).toBe("downloadable");
    await expect(service.remove("downloadable")).rejects.toThrow("先切换");

    await service.activate("builtin");
    snapshot = await service.remove("downloadable");
    expect(snapshot.models.find((model) => model.id === "downloadable")?.installed).toBe(false);
  });

  it("allows an optional non-filter model to be deactivated", async () => {
    const root = await mkdtemp(join(tmpdir(), "sanctuary-model-center-optional-"));
    roots.push(root);
    const directory = join(root, "models", "critic");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "model.gguf"), "model");
    await writeFile(join(directory, "sanctuary-model.json"), "{}");
    const critic: ModelCatalogEntry = {
      ...entry("critic", [file("model.gguf", "https://example.test/model.gguf", Buffer.from("model"))], "light"),
      capability: "art_critic",
      runtime: "llama_cpp_vlm"
    };
    let selected = "critic";
    const service = new ModelCenterService({
      modelsRoot: join(root, "models"),
      bundledModels: {},
      readActiveModelId: () => selected,
      writeActiveModelId: (_capability, modelId) => { selected = modelId; },
      catalog: [critic]
    });

    expect((await service.snapshot()).activeByCapability.art_critic).toBe("critic");
    await service.deactivate("critic");
    expect(selected).toBe("");
    expect((await service.snapshot()).activeByCapability.art_critic).toBeUndefined();
  });

  it("rejects files whose declared hash does not match", async () => {
    const root = await mkdtemp(join(tmpdir(), "sanctuary-model-center-hash-"));
    roots.push(root);
    const payload = Buffer.from("actual");
    const model = entry("bad-hash", [{
      fileName: "model.onnx",
      url: "https://example.test/model.onnx",
      size: payload.length,
      sha256: "0".repeat(64)
    }], "light");
    const service = new ModelCenterService({
      modelsRoot: join(root, "models"),
      bundledModels: {},
      readActiveModelId: () => null,
      writeActiveModelId: () => {},
      catalog: [model],
      fetchImpl: vi.fn(async () => new Response(payload, { status: 200 })) as typeof fetch
    });

    await expect(service.install("bad-hash")).rejects.toThrow("SHA256");
    expect((await service.snapshot()).models[0]?.installed).toBe(false);
  });

  it("falls back to the bundled model when a saved selection is no longer installed", async () => {
    const root = await mkdtemp(join(tmpdir(), "sanctuary-model-center-fallback-"));
    roots.push(root);
    const bundled = join(root, "bundled");
    await mkdir(bundled, { recursive: true });
    await writeFile(join(bundled, "model.onnx"), "builtin");
    await writeFile(join(bundled, "selected_tags.csv"), "tags");
    const catalog = [
      entry("builtin", [
        file("model.onnx", "https://example.test/builtin.onnx", Buffer.from("builtin")),
        file("selected_tags.csv", "https://example.test/builtin.csv", Buffer.from("tags"))
      ], "balanced"),
      entry("missing-selection", [
        file("model.onnx", "https://example.test/missing.onnx", Buffer.from("missing")),
        file("selected_tags.csv", "https://example.test/missing.csv", Buffer.from("tags"))
      ], "advanced")
    ];
    let selected = "missing-selection";
    const service = new ModelCenterService({
      modelsRoot: join(root, "models"),
      bundledModels: { builtin: bundled },
      readActiveModelId: () => selected,
      writeActiveModelId: (_capability, modelId) => { selected = modelId; },
      catalog
    });

    const snapshot = await service.snapshot();
    expect(snapshot.activeByCapability.element_tagging).toBe("builtin");
    expect(selected).toBe("builtin");
  });
});

function entry(
  id: string,
  files: ModelCatalogEntry["files"],
  tier: ModelCatalogEntry["tier"]
): ModelCatalogEntry {
  const bytes = files.reduce((sum, item) => sum + item.size, 0);
  return {
    id,
    name: id,
    version: "v1/test",
    author: "test",
    description: "test model",
    capability: "element_tagging",
    runtime: "wd_onnx",
    tier,
    availability: "ready",
    license: "MIT",
    homepage: "https://huggingface.co/test/model",
    downloadSize: bytes,
    diskSize: bytes,
    recommendedRamGb: 1,
    recommendedVramGb: 0,
    badges: [],
    files
  };
}

function file(fileName: string, url: string, content: Buffer): ModelCatalogEntry["files"][number] {
  return {
    fileName,
    url,
    size: content.length,
    sha256: createHash("sha256").update(content).digest("hex")
  };
}
