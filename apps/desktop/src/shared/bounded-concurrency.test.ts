import { describe, expect, it } from "vitest";
import { AsyncTaskGate, mapWithConcurrency } from "./bounded-concurrency.js";

describe("bounded concurrency", () => {
  it("never exceeds the task gate limit", async () => {
    const gate = new AsyncTaskGate(2);
    let active = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 8 }, (_, index) => gate.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return index;
    })));
    expect(peak).toBe(2);
  });

  it("preserves result order while running workers concurrently", async () => {
    const result = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
      await Promise.resolve();
      return value * 2;
    });
    expect(result).toEqual([6, 2, 4]);
  });
});
