export class AsyncTaskGate {
  readonly #limit: number;
  #active = 0;
  readonly #waiters: Array<() => void> = [];

  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("Concurrency limit must be a positive integer");
    }
    this.#limit = limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await task();
    } finally {
      this.#release();
    }
  }

  async #acquire(): Promise<void> {
    if (this.#active < this.#limit) {
      this.#active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.#waiters.push(resolve));
    this.#active += 1;
  }

  #release(): void {
    this.#active = Math.max(0, this.#active - 1);
    this.#waiters.shift()?.();
  }
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Concurrency limit must be a positive integer");
  }
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index] as T, index);
    }
  };
  const workerCount = Math.min(limit, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
