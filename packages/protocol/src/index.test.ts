import { describe, expect, it } from "vitest";
import { isVisionRequest, isVisionResponse } from "./index.js";

describe("vision readiness protocol", () => {
  it("accepts the health handshake without requiring an image path", () => {
    expect(isVisionRequest({
      version: 1,
      id: "health-1",
      type: "health-check",
      payload: {}
    })).toBe(true);
    expect(isVisionResponse({
      version: 1,
      id: "health-1",
      type: "health-check-result",
      payload: {
        status: "ready",
        engine: "fixture",
        engineVersion: "1"
      }
    })).toBe(true);
  });
});
