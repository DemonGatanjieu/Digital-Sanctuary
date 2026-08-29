import { describe, expect, it } from "vitest";
import { FINE_ART_SUITE_V1 } from "@sanctuary/domain";
import { generateStandardTestFixtures } from "../../../../../services/vision/src/fixtures.js";
import { VisionSecretStore } from "./vision-secret-store.js";
import { ExternalVisionService } from "./external-vision-service.js";
import { FakeVisionAdapter } from "./adapters/fake-adapter.js";
import type { PreparedVisionImage } from "./vision-image-preprocessor.js";

describe("ExternalVisionService and FakeVisionAdapter", () => {
  const secretStore = new VisionSecretStore();
  const service = new ExternalVisionService(secretStore);
  const fakeAdapter = service.getAdapter("fake") as FakeVisionAdapter;

  const fixtures = generateStandardTestFixtures();
  const sampleImage: PreparedVisionImage = {
    buffer: fixtures.solidColor,
    mimeType: "image/png",
    width: 64,
    height: 64,
    byteLength: fixtures.solidColor.length,
    fingerprint: "test_fixture_hash",
    cleanup: () => {}
  };

  it("manages public config safely without exposing raw API keys", () => {
    service.savePublicConfig(
      {
        id: "openai",
        provider: "openai",
        model: "gpt-4o",
        endpoint: "https://api.openai.com/v1",
        hasApiKey: false,
        enabled: true,
        maxConcurrency: 1,
        maxLongEdge: 1568
      },
      "sk-proj-super-secret-key-1234"
    );

    const publicConfig = service.getPublicConfig("openai");
    expect(publicConfig.hasApiKey).toBe(true);
    expect(publicConfig.keyHint).toBe("sk-...1234");
    // Explicitly verify raw key is never in public config object
    expect((publicConfig as any).apiKey).toBeUndefined();
  });

  it("restores public provider settings without persisting secrets", () => {
    const persisted = new Map<string, import("@sanctuary/domain").ExternalVisionPublicConfig>();
    const persistence = {
      read: (providerId: import("@sanctuary/domain").ExternalVisionProviderId) => persisted.get(providerId) ?? null,
      write: (config: import("@sanctuary/domain").ExternalVisionPublicConfig) => { persisted.set(config.provider, config); }
    };
    const first = new ExternalVisionService(new VisionSecretStore(), persistence);
    first.savePublicConfig({
      id: "gemini",
      provider: "gemini",
      model: "gemini-vision-test",
      hasApiKey: false,
      enabled: true,
      maxConcurrency: 2,
      maxLongEdge: 1024
    }, "secret-value");

    expect(persisted.get("gemini")).toMatchObject({ enabled: true, model: "gemini-vision-test", hasApiKey: false });
    expect(persisted.get("gemini")?.keyHint).toBeUndefined();
    const restored = new ExternalVisionService(new VisionSecretStore(), persistence);
    expect(restored.getPublicConfig("gemini")).toMatchObject({ enabled: true, model: "gemini-vision-test" });
  });

  it("analyzes image with FakeVisionAdapter using FINE_ART_SUITE_V1", async () => {
    fakeAdapter.setMode("success");
    const result = await service.analyzeImage("fake", sampleImage, FINE_ART_SUITE_V1);

    expect(result.status).toBe("success");
    expect(result.dimensions).toHaveLength(6);
    expect(result.dimensions.map((d) => d.key)).toEqual([
      "composition",
      "color_harmony",
      "lighting",
      "visual_focus",
      "atmosphere",
      "detail_control"
    ]);
    for (const d of result.dimensions) {
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(100);
    }
  });

  it("handles test connection success and failure modes gracefully", async () => {
    fakeAdapter.setMode("success");
    const ok = await service.testConnection("fake");
    expect(ok.success).toBe(true);
    expect(ok.latencyMs).toBeGreaterThanOrEqual(1);

    fakeAdapter.setMode("rate_limited");
    const rateLimited = await service.testConnection("fake");
    expect(rateLimited.success).toBe(false);
    expect(rateLimited.error).toContain("Rate Limited");

    fakeAdapter.setMode("content_blocked");
    const blocked = await service.testConnection("fake");
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain("安全审查");
  });
});
