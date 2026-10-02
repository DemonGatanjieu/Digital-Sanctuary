import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { InspirationConversation } from "@sanctuary/domain";
import { createInspirationOutputHost, inspirationMarkdown, inspirationMarkdownFileName } from "./inspiration-export.js";

const native = vi.hoisted(() => ({ dialog: { showSaveDialog: vi.fn() }, clipboard: { writeText: vi.fn() } }));
vi.mock("electron", () => native);

const conversation: InspirationConversation = {
  id: "conversation-export", title: "角色设定", presetId: "character_profile", modelId: "current-model",
  settings: { creativity: "balanced", responseLength: "standard" },
  source: { workId: "work-1", title: "参考作品", artistName: "画师", pageIndex: 2, imageUrl: "sanctuary-image://local/E%3A%5Cprivate%5Cp2.png" },
  messages: [
    { id: "user-1", role: "user", content: "请整理人物动机", createdAt: "2026-10-03T01:00:00.000Z" },
    { id: "reply-1", role: "assistant", content: "## 人物动机\n\n寻找故乡。", createdAt: "2026-10-03T01:00:02.000Z", provenance: {
      modelId: "actual-model", modelVersion: "v1", evaluatorVersion: "llama-test",
      settings: { creativity: "precise", responseLength: "brief" },
      parameters: { temperature: 0.35, topP: 0.82, topK: 32, maxTokens: 600 },
      source: { workId: "work-1", title: "参考作品", artistName: "画师", pageIndex: 2 }, durationMs: 1500
    } }
  ], createdAt: "2026-10-03T01:00:00.000Z", updatedAt: "2026-10-03T01:00:02.000Z"
};

describe("inspiration Markdown export", () => {
  it("keeps answer provenance and usable Markdown without local image paths", () => {
    const markdown = inspirationMarkdown(conversation);
    expect(markdown).toContain("## 人物动机\n\n寻找故乡。");
    expect(markdown).toContain("实际模型：actual-model");
    expect(markdown).toContain("模型版本：v1");
    expect(markdown).toContain("严谨 / 简短");
    expect(markdown).toContain("temperature=0.35");
    expect(markdown).toContain("第 3 页（pageIndex=2）");
    expect(markdown).toContain("1.5 秒");
    expect(markdown).not.toContain("sanctuary-image");
    expect(markdown).not.toContain("private");
  });

  it("exports one persisted answer and identifies unavailable historical provenance", () => {
    const reply = { ...conversation.messages[1]!, provenance: undefined };
    const { provenance: _unused, ...oldReply } = reply;
    const markdown = inspirationMarkdown(conversation, oldReply, true);
    expect(markdown).toContain("所选已完成回答");
    expect(markdown).toContain("本轮仍在生成");
    expect(markdown).toContain("这条历史回答未记录实际模型");
    expect(markdown).not.toContain("请整理人物动机");
    expect(markdown).not.toContain("实际模型：current-model");
  });

  it("keeps titles within a single metadata line and produces a safe native picker suggestion", () => {
    expect(inspirationMarkdown({ ...conversation, title: "设定\n[链接](file://x)<script>" })).toContain("# 设定 \\[链接\\](file://x)\\<script\\>");
    expect(inspirationMarkdownFileName("../../角色:设定*?", false)).toBe(".. .. 角色 设定.md");
    expect(inspirationMarkdownFileName("CON", true)).toBe("创作-CON-回答.md");
    expect(inspirationMarkdownFileName("...", false)).toBe("创作对话.md");
    expect(inspirationMarkdownFileName("角色".repeat(100), true).length).toBeLessThan(90);
  });

  it("copies explicitly and cancels file export without writing any file", async () => {
    native.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    const output = createInspirationOutputHost();
    await output.copyText("已完成回答");
    expect(native.clipboard.writeText).toHaveBeenLastCalledWith("已完成回答");
    expect(await output.saveMarkdown("创作.md", "# 已完成内容")).toEqual({ canceled: true });
  });

  it("writes only the main process picker destination atomically and cleans temporary files", async () => {
    const temporaryRoot = resolve(tmpdir());
    const directory = await mkdtemp(join(temporaryRoot, "sanctuary-inspiration-export-test-"));
    try {
      const selectedPath = join(directory, "用户选择.md");
      await writeFile(selectedPath, "旧版本", "utf8");
      native.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: selectedPath });
      const result = await createInspirationOutputHost().saveMarkdown("建议名称.md", "# 标题\n\n中文回答\n");
      expect(result).toEqual({ canceled: false, fileName: "用户选择.md" });
      expect(await readFile(selectedPath, "utf8")).toBe("# 标题\n\n中文回答\n");
      expect(await readdir(directory)).toEqual(["用户选择.md"]);
      expect(native.dialog.showSaveDialog).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "建议名称.md", properties: expect.arrayContaining(["showOverwriteConfirmation"]) }));
    } finally {
      if (!resolve(directory).startsWith(`${temporaryRoot}${sep}sanctuary-inspiration-export-test-`)) throw new Error("Unexpected export test directory");
      await rm(directory, { recursive: true, force: true });
    }
  });
});
