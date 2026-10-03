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
  { id: "models", label: "模型管理", description: "安装、移除模型文件；探索识别可在探索页直接更换。" },
  { id: "connections", label: "高级连接", description: "需要云端画评或本机绘图时再配置。" }
] as const;

export function mainViewFor(view: ActiveView): Exclude<ActiveView, "organize"> {
  return view === "organize" ? "gallery" : view;
}

export function restoreDefaultDownloadLocation(preferences: LibraryPreferences): LibraryPreferences {
  return { ...preferences, downloadDirectory: null };
}
