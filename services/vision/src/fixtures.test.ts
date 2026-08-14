import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateStandardTestFixtures, writeTestFixturesToDisk } from "./fixtures.js";

describe("Vision Test Fixtures Generator", () => {
  it("generates all required synthetic test image buffers with correct magic headers", () => {
    const fixtures = generateStandardTestFixtures();
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const gifSignature = Buffer.from("GIF89a", "ascii");

    expect(fixtures.solidWhite.subarray(0, 8)).toEqual(pngSignature);
    expect(fixtures.solidBlack.subarray(0, 8)).toEqual(pngSignature);
    expect(fixtures.solidColor.subarray(0, 8)).toEqual(pngSignature);
    expect(fixtures.gradientLinear.subarray(0, 8)).toEqual(pngSignature);
    expect(fixtures.checkerboard.subarray(0, 8)).toEqual(pngSignature);

    // Corrupted should start with signature but be truncated
    expect(fixtures.corrupted.subarray(0, 8)).toEqual(pngSignature);
    expect(fixtures.corrupted.includes(Buffer.from("CORRUPTED_PAYLOAD"))).toBe(true);

    // Animated GIF
    expect(fixtures.animatedGif.subarray(0, 6)).toEqual(gifSignature);
  });

  it("writes test fixtures to disk and validates file reading", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sanctuary-fixtures-test-"));
    try {
      const paths = writeTestFixturesToDisk(tempDir);
      expect(paths.solidWhite).toBeDefined();

      const whiteBuffer = readFileSync(paths.solidWhite);
      expect(whiteBuffer.length).toBeGreaterThan(50);
      expect(whiteBuffer.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );

      const corruptedBuffer = readFileSync(paths.corrupted);
      expect(corruptedBuffer.includes(Buffer.from("CORRUPTED_PAYLOAD"))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
