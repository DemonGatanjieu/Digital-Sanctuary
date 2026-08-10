import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { VisionAssessment } from "@sanctuary/domain";
import {
  VISION_PROTOCOL_VERSION,
  isVisionResponse,
  type ClassifyImageRequest
} from "@sanctuary/protocol";

interface PendingRequest {
  resolve: (assessment: VisionAssessment) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface VisionProcessOptions {
  executable: string;
  args: string[];
  engine: string;
  engineVersion: string;
  env?: NodeJS.ProcessEnv;
}

export class VisionClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<string, PendingRequest>();
  readonly engine: string;
  readonly engineVersion: string;
  #available = true;

  constructor(options: VisionProcessOptions) {
    this.engine = options.engine;
    this.engineVersion = options.engineVersion;
    this.#child = spawn(options.executable, options.args, {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    const lines = createInterface({ input: this.#child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.#receive(line));
    this.#child.stderr.on("data", (chunk: Buffer) => {
      console.error(`[vision] ${chunk.toString().trim()}`);
    });
    this.#child.on("error", (error) => {
      this.#available = false;
      this.#rejectAll(error);
    });
    this.#child.on("exit", () => {
      this.#available = false;
      this.#rejectAll(new Error("Vision process exited"));
    });
  }

  get available(): boolean {
    return this.#available;
  }

  classify(imagePath: string, timeoutMs = 5_000): Promise<VisionAssessment> {
    const id = randomUUID();
    const request: ClassifyImageRequest = {
      version: VISION_PROTOCOL_VERSION,
      id,
      type: "classify-image",
      payload: { imagePath }
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("Vision request timed out"));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  close(): void {
    this.#available = false;
    this.#rejectAll(new Error("Vision client closed"));
    this.#child.kill();
  }

  #receive(line: string): void {
    try {
      const response: unknown = JSON.parse(line);
      if (!isVisionResponse(response)) return;
      const pending = this.#pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(response.id);
      if (response.type === "error") {
        pending.reject(new Error(response.payload.message));
      } else {
        pending.resolve(response.payload);
      }
    } catch (error) {
      console.error("Invalid vision response", error);
    }
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
