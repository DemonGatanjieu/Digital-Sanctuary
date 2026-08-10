# A2 WebContentsView / Pixiv 安全容器探针

- 日期：2026-08-10
- Electron：43.3.0
- 状态：通过第一阶段门槛

## 目标

验证 Pixiv 能否运行在独立的 `WebContentsView` 中，并确保 AI 揭开管线尚未完成时，远程图片不会先于审查结果显示。

## 已实现策略

- 使用 `persist:pixiv` 独立、持久化 session，与本地画廊渲染器隔离。
- 远程页面启用 Chromium sandbox 和 context isolation，关闭 Node.js integration。
- 顶层导航只允许 HTTPS `pixiv.net` 及其子域；站外窗口和重定向被拒绝。
- 所有权限请求默认拒绝；当前阶段禁止远程页面发起下载。
- 登录页例外仅允许 `accounts.pixiv.net` 顶层页面中的 `recaptcha.net` 请求获得跨站存储权限；定位、媒体、通知等仍拒绝。
- session 的 `onBeforeRequest` 识别 `i.pximg.net` 的作品缩略图/原图并暂停原请求；后台带 Pixiv `Referer` 获取临时副本，交给 WD Tagger 和元素规则判定，未命中后才继续原请求。
- Pixiv 图标、头像、登录素材等非作品图片直接显示；视频仍在网络阶段取消。
- 常见广告/追踪域名在网络层取消；非 Pixiv 第三方 iframe 默认拒绝，登录页的 reCAPTCHA 例外保留。该策略独立于用户系统浏览器中的扩展。
- 页面边界由本地 React 容器通过窄 IPC 同步，不向远程页面暴露本地 API。

## 实机证据

隔离启动后通过 CDP 自动点击“探索”，得到：

```text
主页面：file:///E:/PIxiv/apps/desktop/out/renderer/index.html
远程页：https://www.pixiv.net/
远程标题：插画、漫画、小说作品交流服务 [pixiv]
公开排行榜作品图：6
本地审查后放行：6
实际完成加载：6（naturalWidth 均为 480）
命中或失败：0
```

React 页面、Pixiv `WebContentsView` 和 Pixiv service worker 是独立调试目标。应用没有出现 preload、React 或主进程异常。

广告拦截复测（公开排行榜）：

```text
网络层广告/追踪拦截：37
第三方 iframe 调试目标：0
作品图：6 / 6 完成审查并加载
总调试目标：3（应用、Pixiv 页面、Pixiv service worker）
```

未加应用内拦截时，同一页面会创建多个广告竞价 iframe 和对应渲染进程；拦截后不再创建这些第三方 iframe，减少了与本地推理争用的进程和网络请求。

登录与布局复测：

```text
官方入口：https://accounts.pixiv.net/login
官方可选项：使用通行密钥登录 / 使用邮箱登录
应用入口：本地工具栏“浏览器设置密码”与“邮箱登录”
1226 × 737 内容区内，远程页面区域为 1226 × 655
侧栏：隐藏
外层 main padding：0
reCAPTCHA requestStorageAccess：未被拒绝
```

没有在测试中输入、读取或保存任何账号凭据。

嵌入式 Google OAuth 复测：应用能从 Pixiv 跳转到 Google 账号页，但提交账号后被 Google 拒绝：

```text
页面：无法登录
提示：此浏览器或应用可能不安全
结果：嵌入式第三方 OAuth 路线不满足可用性门槛
```

该结果发生在已使用同版本 Chrome User-Agent 的情况下，因此没有继续加入 `navigator.webdriver` 等反检测伪装。当前改为在默认浏览器打开 Pixiv 官方密码设置页：用户在受支持浏览器中通过 Google 登录并设置 Pixiv 密码，随后回到应用使用邮箱登录。详见 [KI-0002](../known-issues/KI-0002-google-blocks-embedded-oauth.md)。

## 当前边界

这是已具备最小逐图揭开能力的安全容器，仍有以下产品边界：

- 当前通过 Pixiv CDN URL 识别作品图片，尚未提取作品 ID、画师信息等结构化元数据。
- 审查结果在当前进程内按 URL 去重；临时图片在推理后删除，尚未建立跨重启的内容哈希缓存。
- 被拦截图片目前表现为站点自身的空白/加载失败状态，尚未注入带命中原因和“强行查看”的本地占位层。
- 所有第三方 OAuth 都不在内嵌页面中运行；只提供固定 Pixiv 官方密码设置页的系统浏览器入口和应用内 Pixiv 邮箱登录。
- 下载闭环仍然禁用。

## 下一步

建立持久化缩略图审查缓存和拦截占位层：用内容哈希保存模型版本、规则版本和判定结果；为命中图片显示原因与“强行查看”按钮，并继续保持超时与未知默认遮挡。
