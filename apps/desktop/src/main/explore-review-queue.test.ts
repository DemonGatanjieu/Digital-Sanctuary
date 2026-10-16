import { describe, expect, it } from "vitest";
import { ExploreReviewQueue, RemoteReviewMemoryCache } from "./explore-review-queue.js";

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

  it("reuses review outcomes across thumbnail resolution variants of the same artwork page", () => {
    const cache = new RemoteReviewMemoryCache(20);
    cache.set(
      {
        normalizedUrl: "https://i.pximg.net/c/250x250_80_a2/img-master/img/2026/05/01/00/00/00/123456_p0_square1200.jpg",
        engine: "wd-swinv2-tagger-v3",
        engineVersion: "v3",
        rulesFingerprint: "rules-1"
      },
      { state: "allowed", reasons: [], source: "fresh" }
    );

    const hit = cache.get({
      normalizedUrl: "https://i.pximg.net/img-master/img/2026/05/01/00/00/00/123456_p0_master1200.jpg",
      engine: "wd-swinv2-tagger-v3",
      engineVersion: "v3",
      rulesFingerprint: "rules-1"
    });
    expect(hit).toEqual({ state: "allowed", reasons: [], source: "fresh" });

    const differentPageMiss = cache.get({
      normalizedUrl: "https://i.pximg.net/img-master/img/2026/05/01/00/00/00/123456_p1_master1200.jpg",
      engine: "wd-swinv2-tagger-v3",
      engineVersion: "v3",
      rulesFingerprint: "rules-1"
    });
    expect(differentPageMiss).toBeUndefined();
  });
});

