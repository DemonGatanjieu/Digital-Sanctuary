import { basename } from "node:path";
import { existsSync } from "node:fs";
import type { VisionAssessment } from "@sanctuary/domain";
import type { TechnicalProfilePayload } from "@sanctuary/protocol";
import { TECHNICAL_VISUAL_SUITE_V1 } from "@sanctuary/domain";

/**
 * Development probe only. It proves the process protocol and fail-closed UI,
 * but it is not an image-safety model and must never be presented as one.
 */
export class FilenameProbeEngine {
  async classify(imagePath: string): Promise<VisionAssessment> {
    const startedAt = performance.now();
    const name = basename(imagePath).toLocaleLowerCase();
    const labels: Record<string, number> = { safe: 0.92 };

    if (/(guro|severed|amputee|intestines|corpse)/i.test(name)) {
      labels.guro = 0.98;
      labels.safe = 0.02;
    } else if (/(blood|bloody)/i.test(name)) {
      labels.blood = 0.91;
      labels.safe = 0.3;
    }

    return {
      status: "complete",
      engine: "filename-probe",
      engineVersion: "0.1.0",
      labels,
      elapsedMs: Math.max(1, Math.round(performance.now() - startedAt))
    };
  }

  async computeTechnicalProfile(imagePath: string): Promise<TechnicalProfilePayload> {
    const startedAt = performance.now();
    if (!existsSync(imagePath)) {
      return {
        status: "error",
        suiteId: "technical_visual_v1",
        suiteVersion: 1,
        evaluatorVersion: "0.1.0",
        dimensions: [],
        reasonCode: "file_missing",
        error: `File not found: ${imagePath}`,
        elapsedMs: Math.max(1, Math.round(performance.now() - startedAt))
      };
    }

    // Deterministic probe values based on filename length/hash
    const name = basename(imagePath);
    const hash = Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const dimensions = TECHNICAL_VISUAL_SUITE_V1.dimensions.map((dim, idx) => ({
      key: dim.key,
      label: dim.label,
      score: ((hash * (idx + 1) * 17) % 80) + 15
    }));

    return {
      status: "success",
      suiteId: "technical_visual_v1",
      suiteVersion: 1,
      evaluatorVersion: "0.1.0",
      dimensions,
      elapsedMs: Math.max(1, Math.round(performance.now() - startedAt))
    };
  }
}
