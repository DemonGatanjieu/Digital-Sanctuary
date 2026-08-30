import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InspirationMessage } from "@sanctuary/domain";
import { InspirationMessageTimeline } from "./InspirationView.js";

const history: InspirationMessage[] = [{
  id: "assistant-1",
  role: "assistant",
  content: "上一轮回答",
  createdAt: "2026-08-30T00:00:00.000Z"
}];

describe("InspirationMessageTimeline", () => {
  it("keeps the newly sent user message visible while the local model is thinking", () => {
    const markup = renderToStaticMarkup(
      <InspirationMessageTimeline
        messages={history}
        pendingUserMessage="这条消息不能在思考时消失"
        thinking
      />
    );

    expect(markup).toContain("上一轮回答");
    expect(markup).toContain("你 · 已发送");
    expect(markup).toContain("这条消息不能在思考时消失");
    expect(markup).toContain("正在认真想……");
    expect(markup.indexOf("这条消息不能在思考时消失")).toBeLessThan(markup.indexOf("正在认真想……"));
  });

  it("does not duplicate a pending bubble after the completed conversation arrives", () => {
    const markup = renderToStaticMarkup(
      <InspirationMessageTimeline
        messages={[...history, {
          id: "user-1",
          role: "user",
          content: "已经写入历史",
          createdAt: "2026-08-30T00:00:01.000Z"
        }]}
        pendingUserMessage={null}
        thinking={false}
      />
    );

    expect(markup.match(/已经写入历史/g)).toHaveLength(1);
    expect(markup).not.toContain("你 · 已发送");
    expect(markup).not.toContain("正在认真想……");
  });
});
