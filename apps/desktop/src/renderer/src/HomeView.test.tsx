import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeView } from "./HomeView";
import { AnalysisView } from "./AnalysisView";

describe("task-oriented entry points", () => {
  it("offers four direct tasks and a local import entry", () => {
    const markup = renderToStaticMarkup(<HomeView workCount={0} importing={false} onSelect={() => {}} onImport={() => {}} />);
    expect([...markup.matchAll(/data-home-task="([^"]+)"/g)].map((match) => match[1]))
      .toEqual(["gallery", "explore", "organize", "inspiration"]);
    expect(markup).toContain("第一次使用");
    expect(markup).not.toContain("type=\"range\"");
  });

  it("defaults organizing to exploration rules without exposing technical inputs", () => {
    const markup = renderToStaticMarkup(<AnalysisView collections={[]} artists={[]} selectedWorkIds={[]}
      status={null} error="" onApplied={async () => {}} onError={() => {}} onOpenProtection={() => {}} />);
    expect(markup).toContain("默认使用探索的元素规则");
    expect(markup).toContain("查找需要关注的作品");
    expect(markup).not.toContain("type=\"range\"");
    expect(markup).not.toContain("自定义特征标签");
    expect(markup).not.toContain("移入回收站");
  });
});
