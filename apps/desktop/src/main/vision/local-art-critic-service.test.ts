import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADAPTIVE_ART_SUITE_V1, type ModelCatalogEntry } from "@sanctuary/domain";
import type { ResolvedRuntimeModel } from "../model-center/model-center-service.js";
import { LocalArtCriticService } from "./local-art-critic-service.js";

const fixture = fileURLToPath(new URL("../fixtures/local-art-critic-fixture.mjs", import.meta.url));
const entry: ModelCatalogEntry = {
  id: "local-critic-fixture",
  name: "fixture",
  version: "test",
  author: "test",
  description: "test",
  capability: "art_critic",
  runtime: "llama_cpp_vlm",
  tier: "light",
  availability: "ready",
  license: "MIT",
  homepage: "https://github.com/test/test",
  downloadSize: 1,
  diskSize: 1,
  recommendedRamGb: 1,
  recommendedVramGb: 0,
  badges: [],
  files: []
};
const runtime: ResolvedRuntimeModel = { entry, modelDirectory: process.cwd(), bundled: false };
const buildFixtureCommand = (_runtime: ResolvedRuntimeModel, port: number) => ({
  executable: process.execPath,
  args: [fixture, String(port)],
  cwd: process.cwd()
});

describe("LocalArtCriticService", () => {
  it("starts a loopback runtime and validates model-selected six dimensions", async () => {
    const service = new LocalArtCriticService({
      resolveActiveModel: async () => runtime,
      startupTimeoutMs: 5_000,
      idleTimeoutMs: 30_000,
      buildCommand: buildFixtureCommand
    });
    try {
      await service.activate(runtime);
      const evaluation = await service.analyze({
        buffer: Buffer.from("image"),
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteLength: 5,
        fingerprint: "fixture",
        cleanup: () => {}
      }, ADAPTIVE_ART_SUITE_V1);
      expect(evaluation.result.status).toBe("success");
      expect(evaluation.result.dimensions).toHaveLength(6);
      expect(evaluation.result.dimensions[0]).toMatchObject({ key: "story_staging", label: "自选维度1" });
    } finally {
      service.close();
    }
  });

  it("stops the runtime and returns a timeout instead of hanging forever", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      if (!String(input).endsWith("/v1/chat/completions")) return fetch(input, init);
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    const service = new LocalArtCriticService({
      resolveActiveModel: async () => runtime,
      fetchImpl,
      startupTimeoutMs: 5_000,
      inferenceTimeoutMs: 25,
      idleTimeoutMs: 30_000,
      buildCommand: buildFixtureCommand
    });
    try {
      const evaluation = await service.analyze({
        buffer: Buffer.from("image"),
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteLength: 5,
        fingerprint: "fixture-timeout",
        cleanup: () => {}
      }, ADAPTIVE_ART_SUITE_V1);
      expect(evaluation.result.status).toBe("timeout");
      expect(evaluation.result.reasonCode).toBe("local_timeout");
    } finally {
      service.close();
    }
  });
});
