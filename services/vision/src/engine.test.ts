import { describe, expect, it } from "vitest";
import { FilenameProbeEngine } from "./engine.js";
import { generateStandardTestFixtures, writeTestFixturesToDisk } from "./fixtures.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("FilenameProbeEngine", () => {
  const engine = new FilenameProbeEngine();

  it("marks unwanted-element probe filenames", async () => {
    const result = await engine.classify("E:\\fixtures\\sample-guro.png");
    expect(result.labels.guro).toBeGreaterThan(0.9);
  });

  it("leaves ordinary filenames safe", async () => {
    const result = await engine.classify("E:\\fixtures\\landscape.png");
    expect(result.labels.safe).toBeGreaterThan(0.9);
    expect(result.labels.guro).toBeUndefined();
  });

  it("computes technical visual profile on image file and handles missing files", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "probe-tech-test-"));
    try {
      const paths = writeTestFixturesToDisk(tempDir);
      const res = await engine.computeTechnicalProfile(paths.solidWhite);
      expect(res.status).toBe("success");
      expect(res.suiteId).toBe("technical_visual_v1");
      expect(res.dimensions).toHaveLength(6);

      const missing = await engine.computeTechnicalProfile(join(tempDir, "none.png"));
      expect(missing.status).toBe("error");
      expect(missing.reasonCode).toBe("file_missing");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
