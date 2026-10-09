import type { LibraryPreferences } from "@sanctuary/domain";

export type ActiveView = "home" | "gallery" | "organize" | "inspiration" | "explore" | "settings";
export type SettingsSection = "library" | "appearance" | "protection" | "models" | "connections";

export const MAIN_NAVIGATION = [
  { id: "gallery", label: "图库", description: "浏览作品、相册与画师", icon: "gallery" },
  { id: "organize", label: "整理", description: "找图、排查与批量入册", icon: "organize" },
  { id: "explore", label: "探索", description: "浏览图片网站，收进图库", icon: "explore" },
  { id: "inspiration", label: "创作", description: "聊图、写作与提示词", icon: "create" }
] as const;

export const SETTINGS_SECTIONS = [
  { id: "library", label: "图库与存储", description: "默认浏览方式、保存目录和备份。" },
  { id: "appearance", label: "外观与显示", description: "主题、头像、字体和显示性能。" },
  { id: "models", label: "模型管理", description: "安装、移除模型文件；探索识别可在探索页直接更换。" },
  { id: "connections", label: "高级连接", description: "需要云端画评或本机绘图时再配置。" }
] as const;

export function restoreDefaultDownloadLocation(preferences: LibraryPreferences): LibraryPreferences {
  return { ...preferences, downloadDirectory: null };
}
