import type { LibraryPreferences } from "@sanctuary/domain";

export type ActiveView = "gallery" | "organize" | "inspiration" | "explore" | "settings";
export type SettingsSection = "library" | "appearance" | "protection" | "models" | "connections";

export const MAIN_NAVIGATION = [
  { id: "gallery", label: "图库", description: "浏览、相册与整理" },
  { id: "explore", label: "探索", description: "浏览 Pixiv，保存喜欢的作品" },
  { id: "inspiration", label: "创作", description: "聊图、写作与提示词" },
  { id: "settings", label: "设置", description: "外观、存储与模型" }
] as const;

export const SETTINGS_SECTIONS = [
  { id: "library", label: "图库与存储", description: "默认浏览方式、保存目录和备份。" },
  { id: "appearance", label: "外观与显示", description: "主题、头像、字体和显示性能。" },
  { id: "protection", label: "探索保护", description: "不想看到的元素、个人偏好和规则测试。" },
  { id: "models", label: "本地模型", description: "安装和切换用于识别、画评与创作的模型。" },
  { id: "connections", label: "外部连接", description: "按需配置外部 AI 服务和本机 ComfyUI。" }
] as const;

export function mainViewFor(view: ActiveView): Exclude<ActiveView, "organize"> {
  return view === "organize" ? "gallery" : view;
}

export function restoreDefaultDownloadLocation(preferences: LibraryPreferences): LibraryPreferences {
  return { ...preferences, downloadDirectory: null };
}
