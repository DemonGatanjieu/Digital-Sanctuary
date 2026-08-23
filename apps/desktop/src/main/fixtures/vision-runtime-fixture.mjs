import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "ready";
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.type === "health-check") {
    if (mode === "error") {
      write({
        version: 1,
        id: request.id,
        type: "error",
        payload: { code: "MODEL_MISSING", message: "fixture model is missing" }
      });
      return;
    }
    write({
      version: 1,
      id: request.id,
      type: "health-check-result",
      payload: {
        status: "ready",
        engine: mode === "mismatch" ? "other-engine" : "fixture-engine",
        engineVersion: "1.0.0",
        executionProvider: "fixture-provider"
      }
    });
    return;
  }
  if (request.type === "classify-image") {
    write({
      version: 1,
      id: request.id,
      type: "classify-image-result",
      payload: {
        status: "complete",
        engine: "fixture-engine",
        engineVersion: "1.0.0",
        executionProvider: "fixture-provider",
        labels: { safe: 0.9 },
        elapsedMs: 1
      }
    });
  }
});

function write(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}
