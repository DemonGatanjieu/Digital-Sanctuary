import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryDatabase } from "@sanctuary/database";
import type { VisionClient } from "./vision-client.js";
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
        { key: "colorfulness", label: "色彩丰富度", score: 61 },
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
      expect(second.id).toBe(first.id);
      expect(computeTechnicalProfile).toHaveBeenCalledTimes(1);
      expect(database.listVisionEvaluationsForWork(work.id)).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
