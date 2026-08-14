# 主题前端接入说明

主题后端已经完成。前端只负责主题 CSS 的动态注入、设置页管理界面和商店展示，不应直接访问本地文件、GitHub 或数据库。

## Preload API

以下方法均位于 `window.sanctuary`：

```ts
getInstalledThemes(): Promise<InstalledTheme[]>
getActiveTheme(): Promise<{ themeId: string; cssContent: string; manifest?: ThemeManifest }>
setActiveTheme(themeId: string): Promise<{ success: boolean; cssContent: string }>
deleteTheme(themeId: string): Promise<boolean>
importThemeFromDialog(): Promise<InstalledTheme | null>

fetchStoreCatalog(forceRefresh?: boolean): Promise<StoreCatalogResponse>
installFromStore(themeId: string): Promise<InstalledTheme>
onDownloadProgress(listener): () => void
onThemeChanged(listener): () => void
```

建议应用启动后异步调用 `getActiveTheme()`，并使用 `textContent` 更新固定节点，避免把 CSS 当 HTML 解释：

```ts
const style = document.querySelector<HTMLStyleElement>("#ds-dynamic-theme")
  ?? document.head.appendChild(document.createElement("style"));
style.id = "ds-dynamic-theme";
style.textContent = active.cssContent;
```

监听 `onThemeChanged` 后使用同样方式热切换。组件卸载时必须调用监听函数返回的取消订阅方法。

## 安全与行为约定

- `default` 始终存在，CSS 返回空字符串，表示继续使用应用内置设计令牌。
- 内置主题 `isPreset === true`，不能删除或被用户主题覆盖。
- 用户主题位于 `userData/themes/<theme-id>`；前端不得拼接或读取 `localPath`。
- CSS 最大 512 KiB，并拒绝 `@import`、`url()`、脚本协议及旧式 executable CSS；社区主题不能借主题 CSS 发起外部请求。
- ZIP 最大 20 MiB、64 个条目、解压后 24 MiB；路径穿越、加密包和非 store/deflate 压缩会被拒绝。
- 删除当前主题会自动回退 `default`；损坏主题不会阻止其他主题被发现。

## GitHub 仓库契约

默认仓库为 `Digital-Sanctuary/digital-sanctuary-themes`，分支为 `main`。开发和迁移时可配置：

```text
SANCTUARY_THEME_REPOSITORY=owner/repository
SANCTUARY_THEME_REF=main
SANCTUARY_THEME_GITHUB_TOKEN=可选，仅主进程读取
```

仓库根目录需要 `manifest.json`：

```json
{
  "themes": [
    {
      "id": "author.theme-name",
      "name": "Theme Name",
      "version": "1.0.0",
      "author": "Author",
      "description": "Description",
      "colorScheme": "dark",
      "tags": ["anime"],
      "previewImageUrl": "https://raw.githubusercontent.com/owner/repository/main/themes/author.theme-name/preview.webp",
      "downloadPath": "themes/author.theme-name",
      "updatedAt": "2026-08-14T00:00:00.000Z"
    }
  ]
}
```

对应目录包含 `theme.json`、`theme.css`，以及清单声明的可选预览图。下载时后端会重新校验包内 ID/版本必须与商店目录一致。

目录结果缓存 30 分钟。GitHub 返回 403/429、额度接近耗尽或网络超时时，后端会优先返回最近的持久缓存；没有缓存时才把错误交给 UI 展示。

## 内置骨架

- `default`：现有浅色设计，不注入覆盖。
- `builtin.hollow-zero`：黑黄高对比 token 骨架，可由前端继续美化，但必须保留主题 ID。

当前真实 Electron 冒烟已验证两个主题可发现、Hollow Zero 可激活并返回 CSS、随后可回退默认主题。
