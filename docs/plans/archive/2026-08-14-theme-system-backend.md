# 后端工程任务书：主题引擎（Theme Engine）与 GitHub 主题商店（Theme Store）后端实现

> **归档说明（2026-08-15）**：主题后端、前端接入与视觉回归均已完成；本文件保留用于追溯，不再作为现行施工指令。

> **面向执行者**：GPT / 后端工程 Agent
> **任务目标**：为 Digital Sanctuary 实现安全、健壮、模块化的“动态主题引擎”与“基于 GitHub 的主题商店”的主进程（Main Process）、数据库（Database/Store）、IPC 边界与网络代理服务。

> **执行状态（2026-08-14）**：后端已经完成并通过 86 项 TypeScript 测试、生产构建、真实 Electron 主题切换冒烟和 10,000 作品性能回归。前端接入契约见 `docs/handoff/03_THEME_BACKEND_API.md`。

---

## 1. 架构目标与职责划分

本次重构旨在将前端的视觉呈现（Design Tokens / CSS）解耦为可插拔的“主题（Theme）”，并打通社区生态（通过 GitHub 仓库提交与分发主题）。

### 职责分工
- **后端（本任务范围）**：
  1. 主题包数据结构定义与校验（`ThemeManifest`）。
  2. 内置预设主题（Bundled Presets）与用户安装主题（UserData Themes）的发现、扫描与管理。
  3. 活跃主题（Active Theme）持久化与安全读取（向渲染层提供已净化或校验过的 CSS 字符串）。
  4. 主题安装、卸载、导入（Zip/Folder）服务。
  5. 基于 GitHub REST API 的“主题商店目录获取”与“资源下载”代理（含 GitHub Rate Limit 内存/数据库级缓存、防抖与熔断保护）。
  6. 完整的 IPC 通道与 Preload 类型导出。
  7. 全面的单元测试与集成测试覆盖。
- **前端（后续任务）**：
  1. 渲染层 `<style id="ds-dynamic-theme">` 的动态注入与热切换。
  2. 主题商店界面（瀑布流、卡片、下载进度、预览弹窗）。
  3. 设置页中的“主题切换器”与“本地主题管理”UI。
  4. 具体官方预设主题（如 Hollow Zero 绝区零风格、Cyber Deck 赛博风格）的 CSS/动效撰写。

---

## 2. 核心数据结构与协议规范

### 2.1 主题包元数据规范 (`theme.json` / `ThemeManifest`)

每个主题包是一个文件夹，必须包含 `theme.json`，可选包含 `theme.css` 和 `preview.png`（或 `preview.webp`）。

```typescript
export interface ThemeManifest {
  /** 唯一标识符，格式如 "org.sanctuary.hollow-zero" 或 "author.theme-name"，仅允许 [a-z0-9-_.] */
  id: string;
  /** 主题显示名称，如 "Hollow Zero (绝区零风格)" */
  name: string;
  /** 语义化版本号，如 "1.0.0" */
  version: string;
  /** 主题作者名称 */
  author: string;
  /** 作者 GitHub 或主页链接（可选） */
  authorUrl?: string;
  /** 简要描述 */
  description: string;
  /** 基础色调，用于 UI 占位与高亮："dark" | "light" | "auto" */
  colorScheme: 'dark' | 'light' | 'auto';
  /** 相对路径，指向主题 CSS 文件，默认为 "theme.css" */
  cssEntry?: string;
  /** 相对路径或远程 URL，指向封面预览图，默认为 "preview.png" */
  previewImage?: string;
  /** 标签或分类，如 ["cyberpunk", "anime", "minimal"] */
  tags?: string[];
  /** 最低兼容应用版本 */
  minAppVersion?: string;
  /** 是否为系统内置只读预设 */
  isPreset?: boolean;
}

export interface InstalledTheme extends ThemeManifest {
  /** 本地安装绝对路径 */
  localPath: string;
  /** 安装时间戳 */
  installedAt: number;
  /** 是否为当前生效的主题 */
  isActive: boolean;
}
```

### 2.2 商店目录与清单项规范 (`StoreThemeItem`)

```typescript
export interface StoreThemeItem {
  id: string;
  name: string;
  version: string;
  author: string;
  authorUrl?: string;
  description: string;
  colorScheme: 'dark' | 'light' | 'auto';
  tags: string[];
  /** 预览图直链（通过 raw.githubusercontent.com 或 jsdelivr） */
  previewImageUrl: string;
  /** GitHub 仓库中的相对下载目录 */
  downloadPath: string;
  /** Stars 数或热度（如果 GitHub API 提供） */
  stars?: number;
  /** 更新时间 ISO 字符串 */
  updatedAt: string;
  /** 当前本地是否已安装，如果已安装则附带已安装版本 */
  installedVersion?: string;
}

export interface StoreCatalogResponse {
  themes: StoreThemeItem[];
  fetchedAt: number;
  fromCache: boolean;
  rateLimitRemaining: number;
  rateLimitResetAt: number;
}
```

---

## 3. 后端服务模块设计

请在 `apps/desktop/src/main/` 和 `packages/` 中组织以下模块：

### 3.1 `ThemeManagerService` (`apps/desktop/src/main/theme/theme-manager.ts`)

**职责**：
1. **内置主题扫描**：
   - 从应用打包资源目录（如 `resources/themes/` 或 `apps/desktop/resources/themes/`）扫描出官方预设主题（如 `default`, `hollow-zero`, `cyber-deck`）。
2. **用户主题扫描**：
   - 从 `userData/themes/` 扫描用户下载或手动放入的主题包。
   - 读取并严格校验 `theme.json`（校验字段类型、防止路径遍历攻击）。
3. **活跃主题管理**：
   - 读取/持久化 `active_theme_id`（存储于数据库 `app_settings` 或本地偏好存储）。
   - 提供 `getActiveThemeCss(): Promise<string>`：
     - 若为内置默认主题（`default`），返回空字符串（此时前端使用默认 `tokens.css`）。
     - 若为其他主题，安全读取其 `theme.css` 内容并返回给渲染进程。
     - **安全检查**：移除潜在危险的外部脚本引用（如 `behavior: url(...)` 等废弃 IE 攻击向量），确保仅有纯 CSS 规则。
4. **主题安装与删除**：
   - `installThemeFromFolder(folderPath: string): Promise<InstalledTheme>`
   - `installThemeFromZip(zipBuffer: Buffer): Promise<InstalledTheme>`
   - `deleteTheme(themeId: string): Promise<boolean>`（内置预设不可删除；若删除的是当前活跃主题，自动回退到 `default`）。

### 3.2 `ThemeStoreService` (`apps/desktop/src/main/theme/theme-store.ts`)

**职责**：
1. **GitHub 仓库配置**：
   - 默认社区仓库：`Digital-Sanctuary/digital-sanctuary-themes`（或可通过配置更改）。
   - 目录结构约定：仓库根目录下 `/themes/<theme-id>/theme.json`, `/themes/<theme-id>/theme.css`, `/themes/<theme-id>/preview.png`，或者根目录下 `manifest.json` 索引所有主题。
2. **防超限缓存（Rate Limit Protection）**：
   - GitHub 未认证 API 限制为 60次/小时。
   - 实现内存 + 本地持久化缓存：目录清单（Catalog）缓存有效期 30 分钟（TTL = 1800s）。
   - 响应包含 `X-RateLimit-Remaining` 和 `X-RateLimit-Reset`，在配额耗尽（Remaining <= 1）或触发 403 时，自动返回缓存数据，不向外抛出致命崩溃。
3. **主题下载与安装**：
   - `downloadAndInstallTheme(themeId: string, onProgress?: (progress: number) => void): Promise<InstalledTheme>`
   - 通过 `https` 模块流式拉取 `theme.json`, `theme.css`, `preview.png`。
   - 在临时目录校验完整性后，原子移动（Atomic Rename）至 `userData/themes/<theme-id>`。
   - 触发主题列表刷新，并通过 IPC 向渲染层广播。

### 3.3 数据库集成与偏好存储

在 `packages/database` 或现有的 Settings 表中：
- 增加 `active_theme_id` 键值存储（默认为 `"default"`）。
- （可选）建立 `theme_store_cache` 表记录最近拉取的商店目录 JSON 与 ETag。

---

## 4. IPC 通道与 Preload 接口定义

在 `apps/desktop/src/preload/index.ts`（及相应的类型声明）中提供清晰的 API：

```typescript
export interface ThemeAPI {
  // --- 本地主题管理 ---
  /** 获取所有已安装主题（内置预设 + 用户安装） */
  getInstalledThemes: () => Promise<InstalledTheme[]>;
  /** 获取当前活跃主题 ID 及 CSS 内容 */
  getActiveTheme: () => Promise<{ themeId: string; cssContent: string; manifest?: ThemeManifest }>;
  /** 切换活跃主题 */
  setActiveTheme: (themeId: string) => Promise<{ success: boolean; cssContent: string }>;
  /** 删除已安装的用户主题 */
  deleteTheme: (themeId: string) => Promise<boolean>;
  /** 从本地文件夹或 zip 导入主题 */
  importThemeFromDialog: () => Promise<InstalledTheme | null>;

  // --- 主题商店 ---
  /** 获取主题商店目录（支持强制刷新 forceRefresh） */
  fetchStoreCatalog: (forceRefresh?: boolean) => Promise<StoreCatalogResponse>;
  /** 从商店下载并安装主题 */
  installFromStore: (themeId: string) => Promise<InstalledTheme>;
  /** 监听主题下载进度事件 */
  onDownloadProgress: (callback: (data: { themeId: string; progress: number }) => void) => () => void;
  /** 监听主题变更事件（如安装新主题或切换） */
  onThemeChanged: (callback: (data: { activeThemeId: string; cssContent: string }) => void) => () => void;
}
```

---

## 5. 内置官方预设主题包脚手架（Presets Scaffold）

在项目中创建 `apps/desktop/resources/themes/` 目录，并放置两个开箱即用的预设骨架：

1. **`default` (庇护所标准版)**：
   - 纯净蔚蓝设计，使用现有 Design Tokens。
2. **`hollow-zero` (绝区零风格骨架)**：
   - `theme.json`:
     ```json
     {
       "id": "builtin.hollow-zero",
       "name": "Hollow Zero (空洞探索)",
       "version": "1.0.0",
       "author": "Digital Sanctuary Official",
       "description": "绝区零风格：高反差黑黄撞色、斜切几何切角与充满活力的交互动效",
       "colorScheme": "dark",
       "cssEntry": "theme.css",
       "isPreset": true,
       "tags": ["official", "anime", "zzz", "high-contrast"]
     }
     ```
   - `theme.css`: 定义初步的 CSS 变量覆盖（如 `--ds-color-primary: #FFD200;` 等）。

---

## 6. 质量与验收标准

1. **单测覆盖**：
   - 针对 `ThemeManagerService` 的目录扫描、损坏 JSON 容错、恶意路径校验、CSS 读取进行单元测试。
   - 针对 `ThemeStoreService` 编写 Mock GitHub API 测试（包含 200 成功、403 Rate Limit 触发缓存回退、网络超时熔断）。
2. **无缝启动**：
   - 应用启动时读取主题耗时不得超过 5ms，不得阻塞首屏主窗口渲染。
3. **零破坏既有功能**：
   - 既有的画廊、探索拦截、Pixiv 下载和 WD Tagger 模型分析逻辑完全不受影响。
   - 现有的全部 TypeScript 测试（`npm.cmd test`）必须保持 100% 通过。
