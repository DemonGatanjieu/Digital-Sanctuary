import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VisionAssessment } from "@sanctuary/domain";
import { ElementInspectorDrawer } from "./ElementInspectorDrawer.js";
import { PromptWorkbenchPanel } from "./PromptWorkbenchPanel.js";

const sampleAssessment: VisionAssessment = {
  status: "complete",
  engine: "wd-swinv2-tagger-v3",
  engineVersion: "3.0.0",
  labels: {
    solo: 0.95,
    cat_ears: 0.85,
    smile: 0.65,
    swimsuit: 0.45,
    watermark: 0.35,
    blurry: 0.15
  },
  elapsedMs: 42
};

describe("ElementInspectorDrawer & PromptWorkbench visual components", () => {
  it("renders nothing when target is null", () => {
    const markup = renderToStaticMarkup(
      <ElementInspectorDrawer target={null} onClose={() => undefined} />
    );
    expect(markup).toBe("");
  });

  it("renders accessible dialog container with title and scanning bar placeholder", () => {
    // Mock minimal window.sanctuary
    (globalThis as unknown as { window: { sanctuary: unknown } }).window = {
      sanctuary: {
        status: () => Promise.resolve({ visionReady: true, visionState: "ready", visionProvider: "WD SwinV2" }),
        onAppStatus: () => () => undefined,
        inspectArtwork: () => Promise.resolve({
          assessment: sampleAssessment,
          pages: [{ pageIndex: 0, regularUrl: "sample.jpg" }],
          pageCount: 1,
          activePageIndex: 0
        })
      }
    };

    const markup = renderToStaticMarkup(
      <ElementInspectorDrawer
        target={{ artworkId: "123456", title: "测试画作" }}
        onClose={() => undefined}
      />
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("<h3>读图</h3>");
    expect(markup).toContain("测试画作");
    expect(markup).toContain("重新解析");
  });

  it("renders prompt workbench loading state and semantic prompt preview structures", () => {
    (globalThis as unknown as { window: { sanctuary: unknown } }).window = {
      sanctuary: {
        getPromptWorkspace: () => Promise.resolve({
          version: 2,
          modelProfile: "danbooru",
          negativeLibrary: ["watermark", "low quality"],
          presets: []
        }),
        getComfyUiConfig: () => Promise.resolve({ enabled: false, serverUrl: "http://127.0.0.1:8188" }),
        listComfyUiTemplates: () => Promise.resolve([]),
        listComfyUiJobs: () => Promise.resolve([])
      }
    };

    const markup = renderToStaticMarkup(
      <PromptWorkbenchPanel
        assessment={sampleAssessment}
        workId="work-1"
        pageIndex={0}
      />
    );
    expect(markup).toContain("正在读取本地提示词设置");
  });
});
