import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeView } from "./HomeView";

describe("task-oriented entry points", () => {
  it("offers three direct tasks and a local import entry", () => {
    const markup = renderToStaticMarkup(<HomeView workCount={0} importing={false} onSelect={() => {}} onImport={() => {}} />);
    expect([...markup.matchAll(/data-home-task="([^"]+)"/g)].map((match) => match[1]))
      .toEqual(["gallery", "explore", "inspiration"]);
    expect(markup).toContain("第一次使用");
    expect(markup).toContain("更换背景");
    expect(markup).not.toContain("type=\"range\"");
  });
});
