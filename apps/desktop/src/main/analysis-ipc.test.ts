import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryDatabase } from "@sanctuary/database";
import type { VisionClient } from "./vision-client.js";
import type { LocalArtCriticService } from "./vision/local-art-critic-service.js";
import { evaluateWorkVision } from "./analysis-ipc.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("evaluateWorkVision", () => {
  it("computes a local technical profile once and reuses the cached result", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-radar-"));
    temporaryDirectories.push(directory);
    const imagePath = join(directory, "sample.png");
    writeFileSync(imagePath, "sample image fixture");

    const database = new LibraryDatabase(":memory:");
    database.importArtwork(imagePath);
    const work = database.listWorks()[0]!;
    const computeTechnicalProfile = vi.fn(async () => ({
      status: "success" as const,
      suiteId: "technical_visual_v1" as const,
      suiteVersion: 1 as const,
      evaluatorVersion: "technical-profile-test",
      dimensions: [
        { key: "colorfulness", label: "���", score: 61 },
        { key: "tonal_range", label: "明暗跨度", score: 62 },
        { key: "luminance_balance", label: "亮度均衡度", score: 63 },
        { key: "edge_density", label: "边缘密度", score: 64 },
        { key: "sharpness_proxy", label: "清晰度代理值", score: 65 },
        { key: "spatial_balance", label: "空间分布平衡", score: 66 }
      ],
      elapsedMs: 8
    }));
    const vision = { computeTechnicalProfile } as unknown as VisionClient;

    try {
      const first = await evaluateWorkVision(
        { workId: work.id, suiteId: "technical_visual_v1" },
        database,
        vision
      );
      const second = await evaluateWorkVision(
        { workId: work.id, suiteId: "technical_visual_v1" },
        database,
        vision
      );

      expect(first.status).toBe("success");
      expect(first.dimensions).toHaveLength(6);
      expect(first.dimensions[0]?.label).toBe("色彩丰富度");
      expect(second.id).toBe(first.id);
      expect(computeTechnicalProfile).toHaveBeenCalledTimes(1);
      expect(database.listVisionEvaluationsForWork(work.id)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("persists six dimensions selected by the active local critic", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-adaptive-radar-"));
    temporaryDirectories.push(directory);
    const imagePath = join(directory, "sample.png");
    writeFileSync(imagePath, "sample image fixture");
    const database = new LibraryDatabase(":memory:");
    database.importArtwork(imagePath);
    const work = database.listWorks()[0]!;
    const dimensions = Array.from({ length: 6 }, (_, index) => ({
      key: `chosen_axis_${index}`,
      label: `自选维度${index + 1}`,
      score: 75 + index,
      explanation: "画面证据"
    }));
    const critic = {
      getActiveIdentity: async () => ({
        modelId: "qwen3-vl-2b-instruct-q4",
        modelVersion: "Q4_K_M",
        evaluatorVersion: "llama.cpp-test"
      }),
      analyze: async () => ({
        identity: {
          modelId: "qwen3-vl-2b-instruct-q4",
          modelVersion: "Q4_K_M",
          evaluatorVersion: "llama.cpp-test"
        },
        result: { status: "success" as const, dimensions, summary: "模型自行选择观察维度" }
      })
    } as unknown as LocalArtCriticService;

    try {
      const result = await evaluateWorkVision(
        { workId: work.id, suiteId: "adaptive_art_highlights_v1", providerId: "local_model" },
        database,
        {} as VisionClient,
        undefined,
        critic
      );
      expect(result.kind).toBe("external_adaptive_highlights");
      expect(result.providerId).toBe("local_model");
      expect(result.dimensions).toHaveLength(6);
      expect(database.listVisionEvaluationsForWork(work.id)[0]?.summary).toBe("模型自行选择观察维度");
    } finally {
      database.close();
    }
  });
});
