import { describe, expect, it } from "vitest";
import { FilenameProbeEngine } from "./engine.js";

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
});
