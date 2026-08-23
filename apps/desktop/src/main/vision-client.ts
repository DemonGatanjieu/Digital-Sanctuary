import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { VisionAssessment } from "@sanctuary/domain";
import {
  VISION_PROTOCOL_VERSION,
  isVisionResponse,
  type ClassifyImageRequest,
  type ComputeTechnicalProfileRequest,
  type TechnicalProfilePayload,
  type VisionHealthPayload,
  type VisionHealthRequest
} from "@sanctuary/protocol";

interface PendingRequest {
  resolve: (payload: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface VisionProcessOptions {
  executable: string;
  args: string[];
  engine: string;
  engineVersion: string;
  executionProvider?: string;
  env?: NodeJS.ProcessEnv;
  startupProbeImage?: string;
}

export type VisionRuntimeState = "starting" | "ready" | "failed" | "stopped";

export interface VisionRuntimeSnapshot {
  state: VisionRuntimeState;
  error: string;
  engine: string;
  engineVersion: string;
  executionProvider: string;
}

export class VisionClient {
  #child: ChildProcessWithoutNullStreams | undefined;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #listeners = new Set<(snapshot: VisionRuntimeSnapshot) => void>();
  readonly #options: VisionProcessOptions;
  readonly engine: string;
  readonly engineVersion: string;
  executionProvider: string;
  #state: VisionRuntimeState = "starting";
  #error = "";
  #initialization: Promise<VisionRuntimeSnapshot> | undefined;
  #generation = 0;

  constructor(options: VisionProcessOptions) {
    this.#options = options;
    this.engine = options.engine;
    this.engineVersion = options.engineVersion;
    this.executionProvider = options.executionProvider ?? "unknown";
    this.#spawn();
  }

  get available(): boolean {
    return this.#state === "ready";
  }

  get state(): VisionRuntimeState {
    return this.#state;
  }

  get error(): string {
    return this.#error;
  }

  get snapshot(): VisionRuntimeSnapshot {
    return {
      state: this.#state,
      error: this.#error,
      engine: this.engine,
      engineVersion: this.engineVersion,
      executionProvider: this.executionProvider
    };
  }

  onStateChange(listener: (snapshot: VisionRuntimeSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot);
    return () => this.#listeners.delete(listener);
  }

  initialize(timeoutMs = 45_000): Promise<VisionRuntimeSnapshot> {
    if (this.#state === "ready") return Promise.resolve(this.snapshot);
    if (this.#initialization) return this.#initialization;
    if (!this.#child) this.#spawn();
    const generation = this.#generation;
    this.#setState("starting", "");
    const initialization = this.#requestHealth(timeoutMs)
      .then((health) => {
        if (generation !== this.#generation) throw new Error("Vision startup was superseded");
        if (health.status !== "ready") throw new Error("Vision runtime did not report ready");
        if (health.engine !== this.engine || health.engineVersion !== this.engineVersion) {
          throw new Error(
            `Vision runtime mismatch: expected ${this.engine} ${this.engineVersion}, received ${health.engine} ${health.engineVersion}`
          );
        }
        if (health.executionProvider) this.executionProvider = health.executionProvider;
        if (!this.#options.startupProbeImage) return null;
        const request: ClassifyImageRequest = {
          version: VISION_PROTOCOL_VERSION,
          id: randomUUID(),
          type: "classify-image",
          payload: { imagePath: this.#options.startupProbeImage }
        };
        return this.#request<VisionAssessment>(request, timeoutMs);
      })
      .then((probe) => {
        if (generation !== this.#generation) throw new Error("Vision startup was superseded");
        if (probe && (
          probe.status !== "complete" ||
          probe.engine !== this.engine ||
          probe.engineVersion !== this.engineVersion
        )) {
          throw new Error("Vision startup self-test did not complete with the expected model");
        }
        this.#setState("ready", "");
        return this.snapshot;
      })
      .catch((error: unknown) => {
        if (generation === this.#generation) {
          const message = error instanceof Error ? error.message : "Vision runtime failed to start";
          this.#setState("failed", message);
          this.#terminate(new Error(message));
        }
        throw error;
      })
      .finally(() => {
        if (this.#initialization === initialization) this.#initialization = undefined;
      });
    this.#initialization = initialization;
    return initialization;
  }

  async restart(timeoutMs = 45_000): Promise<VisionRuntimeSnapshot> {
    this.#initialization = undefined;
    this.#terminate(new Error("Vision runtime restarting"));
    this.#spawn();
    return this.initialize(timeoutMs);
  }

  classify(imagePath: string, timeoutMs = 5_000): Promise<VisionAssessment> {
    if (!this.available) return Promise.reject(new Error("Vision runtime is not ready"));
    const request: ClassifyImageRequest = {
      version: VISION_PROTOCOL_VERSION,
      id: randomUUID(),
      type: "classify-image",
      payload: { imagePath }
    };
    return this.#request<VisionAssessment>(request, timeoutMs).catch((error: unknown) => {
      if (error instanceof Error && /timed out|process is unavailable|broken pipe/i.test(error.message)) {
        this.#setState("failed", error.message);
        this.#terminate(error);
      }
      throw error;
    });
  }

  computeTechnicalProfile(imagePath: string, timeoutMs = 10_000): Promise<TechnicalProfilePayload> {
    if (!this.available) return Promise.reject(new Error("Vision runtime is not ready"));
    const request: ComputeTechnicalProfileRequest = {
      version: VISION_PROTOCOL_VERSION,
      id: randomUUID(),
      type: "compute-technical-profile",
      payload: { imagePath }
    };
    return this.#request<TechnicalProfilePayload>(request, timeoutMs);
  }

  close(): void {
    this.#setState("stopped", "");
    this.#terminate(new Error("Vision client closed"));
    this.#listeners.clear();
  }

  #spawn(): void {
    const child = spawn(this.#options.executable, this.#options.args, {
      env: { ...process.env, ...this.#options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.#child = child;
    this.#generation += 1;
    this.#setState("starting", "");

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.#receive(line));
    child.stderr.on("data", (chunk: Buffer) => {
      console.error(`[vision] ${chunk.toString().trim()}`);
    });
    child.on("error", (error) => {
      if (this.#child !== child) return;
      this.#setState("failed", error.message);
      this.#child = undefined;
      this.#rejectAll(error);
    });
    child.on("exit", (code) => {
      if (this.#child !== child) return;
      const error = new Error(`Vision process exited${code === null ? "" : ` with code ${code}`}`);
      this.#child = undefined;
      this.#setState("failed", error.message);
      this.#rejectAll(error);
    });
  }

  #requestHealth(timeoutMs: number): Promise<VisionHealthPayload> {
    const request: VisionHealthRequest = {
      version: VISION_PROTOCOL_VERSION,
      id: randomUUID(),
      type: "health-check",
      payload: {}
    };
    return this.#request<VisionHealthPayload>(request, timeoutMs);
  }

  #request<T extends object>(request: { id: string }, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(request.id);
        reject(new Error("Vision request timed out"));
      }, timeoutMs);
      this.#pending.set(request.id, { resolve, reject, timer });
      const child = this.#child;
      if (!child || child.stdin.destroyed) {
        clearTimeout(timer);
        this.#pending.delete(request.id);
        reject(new Error("Vision process is unavailable"));
        return;
      }
      child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(request.id);
        reject(error);
      });
    });
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
      } else if (response.type === "classify-image-result") {
        if (response.payload.executionProvider) {
          this.executionProvider = response.payload.executionProvider;
        }
        pending.resolve(response.payload);
      } else if (response.type === "compute-technical-profile-result") {
        pending.resolve(response.payload);
      } else if (response.type === "health-check-result") {
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

  #terminate(error: Error): void {
    const child = this.#child;
    this.#child = undefined;
    this.#generation += 1;
    this.#rejectAll(error);
    if (child && !child.killed) child.kill();
  }

  #setState(state: VisionRuntimeState, error: string): void {
    const changed = this.#state !== state || this.#error !== error;
    this.#state = state;
    this.#error = error;
    if (!changed) return;
    const snapshot = this.snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }
}
