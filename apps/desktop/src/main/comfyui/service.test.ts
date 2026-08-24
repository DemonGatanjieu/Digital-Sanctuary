import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LibraryDatabase } from "@sanctuary/database";
import { ComfyUiClient } from "./client.js";
import { ComfyUiService } from "./service.js";
import { parseComfyWorkflowTemplate } from "./workflow.js";

describe("ComfyUI service end-to-end with a mock local server", () => {
  it("uploads an explicit local page, recovers output and records provenance", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-comfy-service-"));
    const sourcePath = join(directory, "source.png");
    const outputDirectory = join(directory, "generated");
    writeFileSync(sourcePath, "source-image");
    const database = new LibraryDatabase(":memory:");
    try {
      database.importArtwork(sourcePath);
      const sourceWork = database.listWorks()[0]!;
      const fakeClient = {
        uploadImage: async () => "sanctuary-source.png",
        queuePrompt: async () => "prompt-1",
        getHistory: async () => ({
          complete: true,
          error: "",
          images: [{ filename: "result.png", subfolder: "", type: "output" }]
        }),
        downloadImage: async () => ({ bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]), contentType: "image/png" })
      } as unknown as ComfyUiClient;
      const service = new ComfyUiService(database, outputDirectory, () => fakeClient);
      service.saveConfig({ enabled: true, baseUrl: "http://127.0.0.1:8188" });
      const template = parseComfyWorkflowTemplate(JSON.stringify({
        "1": { class_type: "CLIPTextEncode", inputs: { text: "old" } },
        "2": { class_type: "LoadImage", inputs: { image: "source.png" } },
        "3": { class_type: "SaveImage", inputs: { filename_prefix: "Sanctuary", images: ["2", 0] } }
      }), "Mock", "template-1");
      service.saveTemplate(template);
      const job = service.startJob({
        workId: sourceWork.id,
        pageIndex: 0,
        templateId: template.id,
        positivePrompt: "cat ears",
        negativePrompt: "blood"
      });

      const completed = await waitForJob(service, job.id);
      expect(completed).toMatchObject({ status: "completed", remotePromptId: "prompt-1" });
      expect(completed.outputWorkId).toBeTruthy();
      expect(existsSync(join(outputDirectory, job.id, "result-1.png"))).toBe(true);
      expect(database.getGenerationProvenance(completed.outputWorkId!)).toMatchObject({
        sourceWorkId: sourceWork.id,
        positivePrompt: "cat ears",
        negativePrompt: "blood",
        provider: "comfyui"
      });
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

async function waitForJob(service: ComfyUiService, jobId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = service.listJobs().find((item) => item.id === jobId)!;
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Mock ComfyUI job did not finish");
}
