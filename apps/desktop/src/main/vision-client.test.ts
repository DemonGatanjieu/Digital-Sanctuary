import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VisionClient } from "./vision-client.js";

const fixture = fileURLToPath(new URL("./fixtures/vision-runtime-fixture.mjs", import.meta.url));

function createClient(mode = "ready") {
  return new VisionClient({
    executable: process.execPath,
    args: [fixture, mode],
    engine: "fixture-engine",
    engineVersion: "1.0.0",
    executionProvider: "unknown",
    startupProbeImage: "fixture-startup-probe.png"
  });
}

describe("VisionClient readiness", () => {
  it("is unavailable until the child confirms that its model is loaded", async () => {
    const client = createClient();
    try {
      expect(client.available).toBe(false);
      const snapshot = await client.initialize(5_000);
      expect(snapshot.state).toBe("ready");
      expect(snapshot.executionProvider).toBe("fixture-provider");
      expect(client.available).toBe(true);
      await expect(client.classify("fixture.png", 2_000))
        .resolves.toMatchObject({ status: "complete", engine: "fixture-engine" });
    } finally {
      client.close();
    }
  });

  it("surfaces model startup errors instead of pretending to be ready", async () => {
    const client = createClient("error");
    try {
      await expect(client.initialize(5_000)).rejects.toThrow("fixture model is missing");
      expect(client.available).toBe(false);
      expect(client.state).toBe("failed");
      expect(client.error).toContain("fixture model is missing");
    } finally {
      client.close();
    }
  });

  it("rejects a runtime whose model identity does not match the application", async () => {
    const client = createClient("mismatch");
    try {
      await expect(client.initialize(5_000)).rejects.toThrow("Vision runtime mismatch");
      expect(client.state).toBe("failed");
    } finally {
      client.close();
    }
  });
});
