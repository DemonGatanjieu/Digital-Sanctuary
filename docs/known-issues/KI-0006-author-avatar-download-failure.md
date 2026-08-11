# KI-0006: Author Avatar Download/Display Failures (画师头像下载与展示失败)

## 问题描述 (Issue Description)

在应用了“画师头像本地化下载”功能后，部分画师在本地画廊中依然不显示头像，退回显示带有首字母的蓝色方块（Monogram）。

## 可能的根本原因 (Possible Root Causes)

### 1. HTTP 429 导致下载流程中断 (Rate Limiting Aborts Flow)
由于批量下载（如“下载全部收藏”）逻辑中，头像下载步骤位于 `fetchPixivArtworkMetadata` 之后。如果请求 P 站 API 依然触发了 429 频率限制（即便加入了 600ms 节流，连续数百次请求仍可能被拦截），那么程序会抛出异常并中断该作品的下载流程，导致头像下载代码永远无法执行。
**影响**：之前漏下头像的作品，在二次运行批量下载时因为被 P 站拉黑，依然无法补全头像。

### 2. Node Fetch 无 Cookie 遭拦截 (Cloudflare / WAF Block)
`downloadPixivOriginalImage` 使用的是无状态的 `globalThis.fetch`（仅携带 `Referer`）。虽然这对于 P 站作品原图 (`img-original`) 是足够的，但对于头像 CDN (`user-profile/img`)，P 站的 Cloudflare 防火墙可能在流量大时要求更严格的指纹或 Cookie 验证，从而返回 403 Forbidden。
**影响**：后端报错 `原图下载失败：HTTP 403`，导致 `avatarLocalPath` 退回为 `null`。

### 3. React 渲染器状态未同步 (Stale Frontend State)
`App.tsx` 中的 `artists` 状态仅在组件挂载 (mount) 时通过 `window.sanctuary.listArtists()` 初始化。当主进程在后台逐个下载并更新 SQLite 数据库中的 `avatar_local_path` 时，并未通过 IPC 事件通知渲染进程主动刷新。
**影响**：头像实际上已经成功下载到本地，但用户在当前视图下无法立刻看到，必须重启应用或切出/切回界面触发状态刷新。

### 4. 默认空头像的合法回退 (Valid Fallback for Default Avatars)
部分 P 站画师可能本身就没有上传头像（使用 Pixiv 默认头像）。后端的 `parsePixivArtworkMetadata` 遇到 `no_profile` 时会主动将 `avatarUrl` 置为 `null`。
**影响**：这属于预期的正常行为，前端会正确渲染首字母 monogram 方块。用户可能会误以为这是下载失败。

## 后续处理建议 (Proposed Mitigations)

1. **更强健的后台下载队列**：重构批量下载，改为纯后台单线程慢速滴漏队列（例如间隔 2-3 秒），彻底避免 429 错误。
2. **分离头像下载流**：将头像下载从作品下载流中解耦。可以提供一个专属的“修复缺失头像”按钮，或者在浏览画师列表时按需懒加载下载。
3. **状态同步机制**：在主进程完成导入或资料更新后，通过 `webContents.send` 广播更新事件，让 React UI 自动重新获取 `artists` 列表。
