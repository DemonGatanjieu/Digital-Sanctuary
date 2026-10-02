import type { InspectArtworkResponse } from "@sanctuary/domain";

export interface InspectorRequest {
  workId?: string;
  artworkId?: string;
  url?: string;
  pageIndex?: number;
}

/** Only the newest target/page request may update results, errors, or loading. */
export class InspectorRequestController {
  private generation = 0;

  constructor(
    private readonly inspect: (request: InspectorRequest) => Promise<InspectArtworkResponse | null>,
    private readonly callbacks: {
      started: () => void;
      result: (response: InspectArtworkResponse | null, request: InspectorRequest) => void;
      failed: (error: unknown) => void;
      settled: () => void;
    }
  ) {}

  invalidate(): void { this.generation += 1; }

  async load(request: InspectorRequest): Promise<void> {
    const generation = ++this.generation;
    this.callbacks.started();
    try {
      const response = await this.inspect(request);
      if (generation === this.generation) this.callbacks.result(response, request);
    } catch (error) {
      if (generation === this.generation) this.callbacks.failed(error);
    } finally {
      if (generation === this.generation) this.callbacks.settled();
    }
  }
}
