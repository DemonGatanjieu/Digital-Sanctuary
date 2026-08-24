import { describe, expect, it } from "vitest";
import { parseComfyWorkflowTemplate, prepareComfyWorkflow } from "./workflow.js";

const workflow = {
  "6": { class_type: "CLIPTextEncode", inputs: { text: "old positive", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "old negative", clip: ["4", 1] } },
  "10": { class_type: "LoadImage", inputs: { image: "example.png" } },
  "12": { class_type: "SaveImage", inputs: { filename_prefix: "Sanctuary", images: ["9", 0] } }
};

describe("ComfyUI workflow boundary", () => {
  it("validates API workflows and binds prompts plus source image", () => {
    const template = parseComfyWorkflowTemplate(JSON.stringify(workflow), "Test", "template-1", "2026-08-24T00:00:00.000Z");
    const prepared = prepareComfyWorkflow(template, {
      positivePrompt: "cat ears",
      negativePrompt: "blood",
      sourceImageName: "sanctuary-source.png"
    });
    expect((prepared.workflow["6"] as any).inputs.text).toBe("cat ears");
    expect((prepared.workflow["7"] as any).inputs.text).toBe("blood");
    expect((prepared.workflow["10"] as any).inputs.image).toBe("sanctuary-source.png");
    expect(prepared.summary).toMatchObject({ positiveBound: true, negativeBound: true, sourceImageBound: true });
  });

  it("rejects local paths and workflows without a prompt binding", () => {
    expect(() => parseComfyWorkflowTemplate(JSON.stringify({
      "1": { class_type: "LoadImage", inputs: { image: "C:\\secret\\image.png" } }
    }), "Unsafe")).toThrow(/绝对路径/);
    const template = parseComfyWorkflowTemplate(JSON.stringify({
      "1": { class_type: "KSampler", inputs: { seed: 1 } }
    }), "No prompt");
    expect(() => prepareComfyWorkflow(template, { positivePrompt: "x", negativePrompt: "" })).toThrow(/正向提示词/);
  });
});
