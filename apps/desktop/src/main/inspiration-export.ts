import { randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { BrowserWindow } from "electron";
import type { InspirationConversation, InspirationExportResult, InspirationMessage, InspirationReplyProvenance } from "@sanctuary/domain";

const PRESET_LABELS = {
  chat: "随便聊聊", image_chat: "聊聊这张图", story_scene: "写成小说片段",
  character_profile: "生成角色设定", world_building: "生成世界观", prompt_notes: "整理提示词"
};
const CREATIVITY_LABELS = { precise: "严谨", balanced: "均衡", imaginative: "放飞" };
const LENGTH_LABELS = { brief: "简短", standard: "标准", detailed: "详细" };

export interface InspirationOutputHost {
  copyText: (text: string) => void | Promise<void>;
  saveMarkdown: (fileName: string, markdown: string) => Promise<InspirationExportResult>;
}

/** Uses only a main-process native file picker; no renderer path or content is accepted. */
export function createInspirationOutputHost(getWindow?: () => BrowserWindow | null | undefined): InspirationOutputHost {
  return {
    async copyText(text) {
      const { clipboard } = await import("electron");
      clipboard.writeText(text);
    },
    async saveMarkdown(fileName, markdown) {
      const { dialog } = await import("electron");
      const options = {
        title: "保存创作 Markdown",
        defaultPath: fileName,
        filters: [{ name: "Markdown 文档", extensions: ["md"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"] as Array<"createDirectory" | "showOverwriteConfirmation">
      };
      const window = getWindow?.();
      const selected = window && !window.isDestroyed()
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (selected.canceled || !selected.filePath) return { canceled: true };
      const temporary = join(dirname(selected.filePath), `.sanctuary-${randomUUID()}.md.tmp`);
      try {
        await writeFile(temporary, markdown, { encoding: "utf8", flag: "wx" });
        await rename(temporary, selected.filePath);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      return { canceled: false, fileName: basename(selected.filePath) };
    }
  };
}

export function inspirationMarkdownFileName(title: string, singleReply: boolean): string {
  const safe = title.normalize("NFKC").replace(/[\x00-\x1f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 70) || "创作对话";
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(safe);
  return `${reserved ? "创作-" : ""}${safe}${singleReply ? "-回答" : ""}.md`;
}

/** Exports only completed, persisted messages; pending renderer bubbles never enter here. */
export function inspirationMarkdown(conversation: InspirationConversation, message?: InspirationMessage, generating = false): string {
  const lines = [
    `# ${metadataText(conversation.title)}${message ? " · 回答" : ""}`,
    "", "纯净领域 · 本地创作记录", "",
    `- 创作方式：${PRESET_LABELS[conversation.presetId]}`,
    `- 对话 ID：${metadataText(conversation.id)}`,
    `- 创建时间：${metadataText(conversation.createdAt)}`,
    `- 最后更新：${metadataText(conversation.updatedAt)}`,
    `- 导出范围：${message ? "所选已完成回答" : "当前已保存的整段对话"}`,
    ""
  ];
  if (generating) lines.push(
    "> 本轮仍在生成。本文件只包含已经保存的消息，不包含未完成回答；已保存的上一版回答会保留。", ""
  );
  const sources = conversation.sources ?? (conversation.source ? [conversation.source] : []);
  if (sources.length) {
    lines.push("## 当前参考图", "", ...sources.flatMap((source,index) => [`### 图片 ${index + 1}`, ...sourceLines(source)]), "",
      "参考图身份仅用于追溯，本文件不嵌入原图或本地文件路径。", "");
  }
  lines.push("## 当前对话设置", "",
    `- 模型选择：${conversation.modelId ? metadataText(conversation.modelId) : "未记录"}`,
    `- 回答气质：${CREATIVITY_LABELS[conversation.settings.creativity]}`,
    `- 回答篇幅：${LENGTH_LABELS[conversation.settings.responseLength]}`,
    "", "以下来源按每条回答记录；当前对话设置不代表所有历史回答的实际设置。", "");
  const messages = message ? [message] : conversation.messages;
  for (const [index, item] of messages.entries()) {
    lines.push(`## ${message ? "回答" : `${index + 1}. ${item.role === "user" ? "你" : "本地模型"}`}`, "",
      `时间：${metadataText(item.createdAt)}`, "");
    if (item.role === "assistant") {
      lines.push(...provenanceLines(item.provenance), "");
    }
    lines.push(item.content.replace(/\r\n/g, "\n"), "", "---", "");
  }
  return lines.join("\n");
}

function provenanceLines(provenance: InspirationReplyProvenance | undefined): string[] {
  if (!provenance) return ["> 这条历史回答未记录实际模型、生成参数、耗时与参考图来源。"];
  const parameters = provenance.parameters;
  return [
    `- 实际模型：${metadataText(provenance.modelId)}`,
    `- 模型版本：${metadataText(provenance.modelVersion)}`,
    `- 本地运行时版本：${metadataText(provenance.evaluatorVersion)}`,
    `- 回答气质 / 篇幅：${CREATIVITY_LABELS[provenance.settings.creativity]} / ${LENGTH_LABELS[provenance.settings.responseLength]}`,
    `- 生成参数：temperature=${parameters.temperature}，top_p=${parameters.topP}，top_k=${parameters.topK}，max_tokens=${parameters.maxTokens}`,
    `- 本轮耗时：${(provenance.durationMs / 1000).toFixed(1)} 秒（含准备与等待）`,
    ...(provenance.sources?.length ? provenance.sources.flatMap((source,index) => [`- 图片 ${index + 1}`, ...sourceLines(source)]) : provenance.source ? sourceLines(provenance.source) : ["- 本轮参考图：无"])
  ];
}

function sourceLines(source: { workId: string; title: string; artistName: string | null; pageIndex: number }): string[] {
  return [
    `- 参考作品：${metadataText(source.title)}`,
    `- 画师：${source.artistName ? metadataText(source.artistName) : "本地作品"}`,
    `- 作品 ID：${metadataText(source.workId)}`,
    `- 参考页：第 ${source.pageIndex + 1} 页（pageIndex=${source.pageIndex}）`
  ];
}

function metadataText(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").replace(/([\\`*_{}\[\]<>])/g, "\\$1");
}
