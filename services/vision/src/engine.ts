import { basename } from "node:path";
import type { VisionAssessment } from "@sanctuary/domain";

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
}
