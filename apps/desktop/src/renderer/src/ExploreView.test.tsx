import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExploreView, initialExploreState } from "./ExploreView.js";
import { ExploreProtectionPanel } from "./ExploreProtectionPanel";

describe("Explore protection states", () => {
  it("keeps an address/search field available and describes generic sites as unprotected", () => {
    const markup=renderToStaticMarkup(<ExploreView state={{...initialExploreState,browserMode:"web",protectionStatus:"bypassed",url:"https://example.org/",title:"图片网站"}} error="" onStateChange={()=>{}} onError={()=>{}} />);
    expect(markup).toContain("网址或图片搜索");expect(markup).toContain("此站未适配元素拦截");expect(markup).toContain("图片上右键");expect(markup).not.toContain("恢复保护");expect(markup).not.toContain("邮箱登录");
  });
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

  it("exposes protection in the current task and keeps diagnostics out of the toolbar", () => {
    const markup = renderToStaticMarkup(<ExploreView state={{ ...initialExploreState, protectionStatus: "ready", remoteReviewCacheHits: 57 }}
      error="" onStateChange={() => undefined} onError={() => undefined} onProtectionOpen={() => undefined} />);
    expect(markup).toContain("浏览保护");
    expect(markup).toContain("保护已开启");
    expect(markup).not.toContain("缓存 57");
    expect(markup).not.toContain("浏览器设置密码</button>");
  });

  it("starts with ordinary rules and hides raw tags, thresholds and installation forms", () => {
    const markup = renderToStaticMarkup(<ExploreProtectionPanel state={initialExploreState} status={null} settings={[]} customGroups={[]}
      busy={false} onBusyChange={() => undefined}
      onSettingsChange={() => undefined} onCustomGroupsChange={async () => undefined} onClose={() => undefined} />);
    expect(markup).toContain("隐藏哪些内容");
    expect(markup).toContain("高级规则与诊断");
    expect(markup).not.toContain('type="range"');
    expect(markup).not.toContain("model-card-grid");
    expect(markup).not.toContain("defaultThreshold");
  });
});
