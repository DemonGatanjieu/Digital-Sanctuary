import { describe, expect, it } from "vitest";
import { presetSystemPrompt } from "./inspiration-ipc.js";

describe("local inspiration prompt presets", () => {
  it("keeps image-grounded conversation honest when no image is attached", () => {
    const prompt = presetSystemPrompt("image_chat", false);
    expect(prompt).toContain("不要假装自己看到了图片");
    expect(prompt).toContain("叙事线索");
  });

  it("keeps prompt notes separate from classifier confidence", () => {
    expect(presetSystemPrompt("prompt_notes", true)).toContain("不要把识别置信度当生成权重");
  });
});
