import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExploreView, initialExploreState } from "./ExploreView.js";

describe("Explore protection states", () => {
  it("presents a single model failure gate instead of calling every image blocked", () => {
    const markup = renderToStaticMarkup(
      <ExploreView
        state={{
          ...initialExploreState,
          protectionStatus: "failed",
          protectionError: "model.onnx is missing"
        }}
        error=""
        onStateChange={() => undefined}
        onError={() => undefined}
      />
    );

    expect(markup).toContain("识别模型尚未就绪");
    expect(markup).toContain("这不是图片命中规则");
    expect(markup).toContain("本次无保护浏览");
    expect(markup).not.toContain("作品已按规则拦截");
  });
});
