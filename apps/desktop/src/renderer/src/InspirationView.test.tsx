import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { extractPromptsFromReply, smartConversationTitle, type InspirationMessage } from "@sanctuary/domain";
import { buildQuickPromptChips, InspirationMessageTimeline } from "./InspirationParts.js";

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

  it("offers output actions only for stable assistant messages and shows actual per-reply origin", () => {
    const markup = renderToStaticMarkup(<InspirationMessageTimeline messages={[{
      ...history[0]!, provenance: {
        modelId: "gemma-test", modelVersion: "v1", evaluatorVersion: "runtime-v1",
        settings: { creativity: "balanced", responseLength: "standard" },
        parameters: { temperature: 0.65, topP: 0.9, topK: 40, maxTokens: 1400 },
        source: { workId: "work-1", title: "参考图", artistName: null, pageIndex: 2 }, durationMs: 1250
      }
    }, { id: "user-stable", role: "user", content: "新提问", createdAt: "2026-10-03T00:00:00Z" }]}
      pendingUserMessage="等待中的用户输入" thinking onCopyReply={() => undefined} onSaveReply={() => undefined} />);
    expect(markup.match(/复制回答/g)).toHaveLength(1);
    expect(markup.match(/保存 Markdown/g)).toHaveLength(1);
    expect(markup).toContain("gemma-test · 1.3 秒 · 参考第 3 页");
    expect(markup).not.toContain("历史回答 · 来源未记录");
  });

  it("keeps historical answer output available while another reply is being generated", () => {
    const markup = renderToStaticMarkup(<InspirationMessageTimeline messages={history} pendingUserMessage={null}
      thinking outputBusy onCopyReply={() => undefined} onSaveReply={() => undefined} />);
    expect(markup).toContain("历史回答 · 来源未记录");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain("正在认真想……");
  });
  it("offers 拿去出图 on replies only when ComfyUI and a reference picture are ready", () => {
    const without = renderToStaticMarkup(<InspirationMessageTimeline messages={history} pendingUserMessage={null} thinking={false} onCopyReply={() => {}} />);
    expect(without).not.toContain("拿去出图");
    const ready = renderToStaticMarkup(<InspirationMessageTimeline messages={history} pendingUserMessage={null} thinking={false} onCopyReply={() => {}} onImageReply={() => {}} />);
    expect(ready).toContain("拿去出图");
  });

  it("extracts positive and negative prompts and builds smart titles and quick chips", () => {
    const split = extractPromptsFromReply([
      "正向提示词：1girl, sunset, seaside, soft lighting",
      "负向约束：lowres, bad anatomy, extra fingers",
      "变体方向：尝试夜景版本"
    ].join("\n"));
    expect(split.extracted).toBe(true);
    expect(split.positive).toContain("1girl, sunset");
    expect(split.negative).toBe("lowres, bad anatomy, extra fingers");

    const title = smartConversationTitle(
      "请认真看看这张图，先说说你看到了什么，再聊聊它可能正在发生什么。",
      "image_chat",
      [{ title: "夏日海边" }]
    );
    expect(title).toBe("夏日海边 · 聊图");

    expect(buildQuickPromptChips(true, 1, false, "示例").map((chip) => chip.label)).toContain("提取英文 Tag");
    expect(buildQuickPromptChips(true, 1, true, "示例").map((chip) => chip.label)).toContain("提炼出图提示词");
  });
});


