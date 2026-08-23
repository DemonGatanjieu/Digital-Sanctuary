import { createInterface } from "node:readline";
import {
  VISION_PROTOCOL_VERSION,
  isVisionRequest,
  type VisionResponse
} from "../../../packages/protocol/dist/index.js";
import { FilenameProbeEngine } from "./engine.js";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const engine = new FilenameProbeEngine();

input.on("line", async (line) => {
  let id = "unknown";
  try {
    const request: unknown = JSON.parse(line);
    if (!isVisionRequest(request)) throw new Error("Invalid vision request");
    id = request.id;
    if (request.type === "health-check") {
      write({
        version: VISION_PROTOCOL_VERSION,
        id,
        type: "health-check-result",
        payload: {
          status: "ready",
          engine: "filename-probe",
          engineVersion: "0.1.0",
          executionProvider: "development-probe"
        }
      });
    } else if (request.type === "compute-technical-profile") {
      const payload = await engine.computeTechnicalProfile(request.payload.imagePath);
      write({
        version: VISION_PROTOCOL_VERSION,
        id,
        type: "compute-technical-profile-result",
        payload
      });
    } else {
      const assessment = await engine.classify(request.payload.imagePath);
      write({
        version: VISION_PROTOCOL_VERSION,
        id,
        type: "classify-image-result",
        payload: assessment
      });
    }
  } catch (error) {
    write({
      version: VISION_PROTOCOL_VERSION,
      id,
      type: "error",
      payload: {
        code: "VISION_REQUEST_FAILED",
        message: error instanceof Error ? error.message : "Unknown vision error"
      }
    });
  }
});

function write(response: VisionResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

export * from "./fixtures.js";
export * from "./engine.js";
