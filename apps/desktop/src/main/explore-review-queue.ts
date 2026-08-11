export type ExploreReviewPriority = "visible" | "near";

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
