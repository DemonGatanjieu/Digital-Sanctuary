import { pixivArtworkPageKey } from "./explore-preference-calibration.js";

export type ExploreReviewPriority = "visible" | "near";

export const EXPLORE_REVIEW_CONCURRENCY = 4;

export interface RemoteReviewOutcome {
  state: "allowed" | "blocked" | "unavailable";
  reasons: string[];
  source: "memory" | "persistent" | "fresh" | "preference" | "error";
}

export interface RemoteReviewCacheKey {
  normalizedUrl: string;
  engine: string;
  engineVersion: string;
  rulesFingerprint: string;
}

export function remoteReviewMemoryKey(key: RemoteReviewCacheKey): string {
  return JSON.stringify(key);
}

export function remoteReviewPageMemoryKey(key: RemoteReviewCacheKey): string | null {
  const pageKey = pixivArtworkPageKey(key.normalizedUrl);
  if (!pageKey) return null;
  return JSON.stringify({
    pageKey,
    engine: key.engine,
    engineVersion: key.engineVersion,
    rulesFingerprint: key.rulesFingerprint
  });
}

/**
 * Bounded LRU memory cache for remote artwork reviews that matches both exact
 * URLs and resolution variants of the same Pixiv artwork page (`<id>_p<index>`).
 */
export class RemoteReviewMemoryCache {
  readonly #entries = new Map<string, RemoteReviewOutcome>();
  readonly #maxEntries: number;

  constructor(maxEntries = 500) {
    this.#maxEntries = maxEntries;
  }

  get(key: RemoteReviewCacheKey): RemoteReviewOutcome | undefined {
    const exactKey = remoteReviewMemoryKey(key);
    const exact = this.#entries.get(exactKey);
    if (exact !== undefined) {
      this.#entries.delete(exactKey);
      this.#entries.set(exactKey, exact);
      return exact;
    }
    const pageKey = remoteReviewPageMemoryKey(key);
    if (!pageKey) return undefined;
    const byPage = this.#entries.get(pageKey);
    if (byPage !== undefined) {
      this.#entries.delete(pageKey);
      this.#entries.set(pageKey, byPage);
      return byPage;
    }
    return undefined;
  }

  set(key: RemoteReviewCacheKey, outcome: RemoteReviewOutcome): void {
    const exactKey = remoteReviewMemoryKey(key);
    this.#putRaw(exactKey, outcome);
    const pageKey = remoteReviewPageMemoryKey(key);
    if (pageKey) this.#putRaw(pageKey, outcome);
  }

  clear(): void {
    this.#entries.clear();
  }

  #putRaw(rawKey: string, outcome: RemoteReviewOutcome): void {
    this.#entries.delete(rawKey);
    this.#entries.set(rawKey, outcome);
    while (this.#entries.size > this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.#entries.delete(oldestKey);
    }
  }
}

export interface ExploreReviewCandidate {
  normalizedUrl: string;
  referrer: string;
  priority: ExploreReviewPriority;
  enqueuedAt: number;
  sequence: number;
}

interface CandidateInput {
  normalizedUrl: string;
  referrer: string;
  priority: ExploreReviewPriority;
}

const priorityRank: Record<ExploreReviewPriority, number> = {
  visible: 0,
  near: 1
};

/**
 * Small deterministic queue for viewport-driven artwork reviews. It deduplicates
 * by normalized URL, upgrades near candidates when they become visible, and
 * preserves FIFO order within the same priority.
 */
export class ExploreReviewQueue {
  readonly #entries = new Map<string, ExploreReviewCandidate>();
  #nextSequence = 0;

  get size(): number {
    return this.#entries.size;
  }

  upsert(input: CandidateInput, now = Date.now()): boolean {
    const existing = this.#entries.get(input.normalizedUrl);
    if (existing) {
      existing.referrer = input.referrer;
      if (priorityRank[input.priority] < priorityRank[existing.priority]) {
        existing.priority = input.priority;
        return true;
      }
      return false;
    }

    this.#entries.set(input.normalizedUrl, {
      ...input,
      enqueuedAt: now,
      sequence: this.#nextSequence++
    });
    return true;
  }

  remove(normalizedUrl: string): boolean {
    return this.#entries.delete(normalizedUrl);
  }

  take(): ExploreReviewCandidate | null {
    let selected: ExploreReviewCandidate | undefined;
    for (const candidate of this.#entries.values()) {
      if (!selected) {
        selected = candidate;
        continue;
      }
      const candidateRank = priorityRank[candidate.priority];
      const selectedRank = priorityRank[selected.priority];
      if (
        candidateRank < selectedRank ||
        (candidateRank === selectedRank && candidate.sequence < selected.sequence)
      ) {
        selected = candidate;
      }
    }
    if (!selected) return null;
    this.#entries.delete(selected.normalizedUrl);
    return selected;
  }

  clear(): void {
    this.#entries.clear();
  }
}

