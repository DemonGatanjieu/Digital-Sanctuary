import { describe, expect, it } from "vitest";
import { describeInspectorFailure, inspectorImageCandidates } from "./inspector-image-candidates.js";

describe("element inspector image acquisition", () => {
  it("prefers the exact image already visible on Pixiv before AJAX alternatives", () => {
    const visible = "https://i.pximg.net/c/540x540_70/img-master/148784131_p2_square1200.jpg?x=1";
    const regular = "https://i.pximg.net/img-master/148784131_p2_master1200.jpg";
    expect(inspectorImageCandidates(visible, [{ pageIndex: 2, thumbUrl: visible, regularUrl: regular }], 2))
      .toEqual([
        "https://i.pximg.net/c/540x540_70/img-master/148784131_p2_square1200.jpg",
        regular
      ]);
  });

  it("rejects unrelated URLs and removes duplicate candidates", () => {
    const image = "https://i.pximg.net/img-master/148784131_p0_master1200.jpg";
    expect(inspectorImageCandidates("https://example.com/not-pixiv.jpg", [{ pageIndex: 0, thumbUrl: image, regularUrl: image }], 0))
      .toEqual([image]);
  });

  it("makes it explicit when image acquisition failed before the model ran", () => {
    const message = describeInspectorFailure(new Error("Thumbnail download failed: HTTP 403"), {
      available: true,
      engine: "wd-swinv2-tagger-v3",
      executionProvider: "CUDAExecutionProvider",
      error: ""
    });
    expect(message).toContain("WD Tagger 已就绪");
    expect(message).toContain("图片尚未送入模型");
    expect(message).toContain("HTTP 403");
  });
});
