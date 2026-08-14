import type {
  ExternalVisionProviderId,
  ExternalVisionPublicConfig,
  VisionSuiteDefinition
} from "@sanctuary/domain";
import { generateStandardTestFixtures } from "../../../../../services/vision/src/fixtures.js";
import { VisionSecretStore } from "./vision-secret-store.js";
import { type PreparedVisionImage } from "./vision-image-preprocessor.js";
import type { ExternalVisionAdapter, ExternalVisionAdapterResult } from "./adapters/types.js";
import { FakeVisionAdapter } from "./adapters/fake-adapter.js";
import { OpenAiVisionAdapter } from "./adapters/openai-adapter.js";

export class ExternalVisionService {
  readonly #secretStore: VisionSecretStore;
  readonly #adapters = new Map<string, ExternalVisionAdapter>();
  readonly #configs = new Map<string, ExternalVisionPublicConfig>();

  constructor(secretStore: VisionSecretStore) {
    this.#secretStore = secretStore;

    // Register adapters
    this.registerAdapter(new FakeVisionAdapter());
    this.registerAdapter(new OpenAiVisionAdapter("openai", false));
    this.registerAdapter(new OpenAiVisionAdapter("openai_compatible", true));

    // Default configuration for OpenAI
    this.#configs.set("openai", {
      id: "openai",
      provider: "openai",
      model: "gpt-4o-mini",
      hasApiKey: false,
      enabled: false,
      maxConcurrency: 1,
      maxLongEdge: 1568
    });

    this.#configs.set("openai_compatible", {
      id: "openai_compatible",
      provider: "openai_compatible",
      model: "qwen-vl-plus",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      hasApiKey: false,
      enabled: false,
      maxConcurrency: 1,
      maxLongEdge: 1568
    });
  }

  registerAdapter(adapter: ExternalVisionAdapter): void {
    this.#adapters.set(adapter.providerId, adapter);
  }

  getAdapter(providerId: string): ExternalVisionAdapter | null {
    return this.#adapters.get(providerId) ?? null;
  }

  getPublicConfig(providerId: string): ExternalVisionPublicConfig {
    const config = this.#configs.get(providerId) ?? {
      id: providerId,
      provider: providerId as ExternalVisionProviderId,
      model: "default-model",
      hasApiKey: false,
      enabled: false,
      maxConcurrency: 1,
      maxLongEdge: 1568
    };

    return {
      ...config,
      hasApiKey: this.#secretStore.hasApiKey(providerId),
      keyHint: this.#secretStore.getApiKeyHint(providerId) ?? undefined
    };
  }

  savePublicConfig(config: ExternalVisionPublicConfig, newApiKey?: string): void {
    this.#configs.set(config.id, {
      ...config,
      hasApiKey: newApiKey ? true : this.#secretStore.hasApiKey(config.provider),
      keyHint: newApiKey ? undefined : (config.keyHint ?? undefined)
    });

    if (newApiKey !== undefined) {
      if (newApiKey.trim()) {
        this.#secretStore.setApiKey(config.provider, newApiKey);
      } else {
        this.#secretStore.deleteApiKey(config.provider);
      }
    }
  }

  deleteApiKey(providerId: string): void {
    this.#secretStore.deleteApiKey(providerId);
    const existing = this.#configs.get(providerId);
    if (existing) {
      this.#configs.set(providerId, {
        ...existing,
        hasApiKey: false,
        keyHint: undefined
      });
    }
  }

  async testConnection(
    providerId: string,
    signal?: AbortSignal
  ): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const adapter = this.#adapters.get(providerId);
    if (!adapter) {
      return { success: false, latencyMs: 0, error: `No adapter found for provider: ${providerId}` };
    }

    const apiKey = this.#secretStore.getApiKey(providerId) ?? "test-key";
    const config = this.getPublicConfig(providerId);

    const fixtures = generateStandardTestFixtures();
    const testImage: PreparedVisionImage = {
      buffer: fixtures.solidColor,
      mimeType: "image/png",
      width: 64,
      height: 64,
      byteLength: fixtures.solidColor.length,
      fingerprint: "test_connection_fixture",
      cleanup: () => {}
    };

    const start = performance.now();
    try {
      const dummySuite: VisionSuiteDefinition = {
        id: "connection_test",
        version: 1,
        name: "Connection Test",
        description: "Test",
        kind: "external_fixed_suite",
        dimensions: [{ key: "test_dim", label: "测试", description: "测试", min: 0, max: 100 }]
      };

      const result = await adapter.analyze({
        image: testImage,
        suite: dummySuite,
        model: config.model,
        apiKey,
        endpoint: config.endpoint,
        signal
      });

      const elapsed = Math.max(1, Math.round(performance.now() - start));
      if (result.status === "success") {
        return { success: true, latencyMs: elapsed };
      }
      return {
        success: false,
        latencyMs: elapsed,
        error: result.summary ?? `Connection failed with status: ${result.status}`
      };
    } catch (error) {
      const elapsed = Math.max(1, Math.round(performance.now() - start));
      return {
        success: false,
        latencyMs: elapsed,
        error: error instanceof Error ? error.message : "Unknown connection error"
      };
    }
  }

  async analyzeImage(
    providerId: string,
    image: PreparedVisionImage,
    suite: VisionSuiteDefinition,
    signal?: AbortSignal
  ): Promise<ExternalVisionAdapterResult> {
    const adapter = this.#adapters.get(providerId);
    if (!adapter) {
      return {
        status: "unsupported",
        dimensions: [],
        reasonCode: "provider_unavailable",
        summary: `未找到 ${providerId} 视觉服务适配器`
      };
    }

    const apiKey = this.#secretStore.getApiKey(providerId);
    if (!apiKey && providerId !== "fake") {
      return {
        status: "auth_error",
        dimensions: [],
        reasonCode: "missing_api_key",
        summary: `尚未配置 ${providerId} 的 API Key`
      };
    }

    const config = this.getPublicConfig(providerId);
    return adapter.analyze({
      image,
      suite,
      model: config.model,
      apiKey: apiKey ?? "",
      endpoint: config.endpoint,
      signal
    });
  }
}
