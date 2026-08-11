import { describe, expect, it } from "vitest";
import { ExploreReviewQueue } from "./explore-review-queue.js";

function candidate(normalizedUrl: string, priority: "visible" | "near") {
  return { normalizedUrl, priority, referrer: "https://www.pixiv.net/" };
}

describe("ExploreReviewQueue", () => {
  it("reviews visible candidates before near candidates", () => {
    const queue = new ExploreReviewQueue();
    queue.upsert(candidate("near-a", "near"), 10);
    queue.upsert(candidate("visible-a", "visible"), 20);
    expect(queue.take()?.normalizedUrl).toBe("visible-a");
    expect(queue.take()?.normalizedUrl).toBe("near-a");
  });

  it("deduplicates URLs and upgrades priority without losing FIFO order", () => {
    const queue = new ExploreReviewQueue();
    queue.upsert(candidate("a", "near"), 10);
    queue.upsert(candidate("b", "visible"), 20);
    expect(queue.upsert(candidate("a", "visible"), 30)).toBe(true);
    expect(queue.size).toBe(2);
    expect(queue.take()?.normalizedUrl).toBe("a");
    expect(queue.take()?.normalizedUrl).toBe("b");
  });

  it("removes inactive queued candidates", () => {
    const queue = new ExploreReviewQueue();
    queue.upsert(candidate("a", "near"));
    expect(queue.remove("a")).toBe(true);
    expect(queue.take()).toBeNull();
  });
});
