# 交接一：当前状态

- 交接日期：2026-08-11
- 工作区：`E:\PIxiv`
- 平台：Windows
- 桌面框架：Electron 43.3.0 + React 19 + TypeScript
- Python：3.14.6
- 视觉引擎：WD SwinV2 Tagger v3 + ONNX Runtime 1.28.0

## 接手前必读

按顺序阅读：

1. `Project_Vision.md`
2. `AI_Filtering_Strategy.md`
3. `ARCHITECTURE.md`
4. `docs/handoff/02_NEXT_IMPLEMENTATION_PLAN.md`
5. `docs/handoff/03_VERIFICATION_CHECKLIST.md`
6. `docs/known-issues/README.md`

不要根据旧草稿恢复年龄分级过滤。项目过滤的是用户不欢迎的画面元素。

## 已完成

- Electron + React 桌面外壳、浅色默认主题和便捷启动脚本。
- 本地图库索引、SQLite、分类与元素规则页面。
- WD Tagger Python 子进程、版本化协议、失败闭合。
- 沙箱化 Pixiv `WebContentsView`、持久化独立 session、沉浸式内容区。
- Electron 单实例锁已启用；重复启动只唤醒已有窗口，避免多进程造成 Pixiv 会话和拦截状态分裂。
- Pixiv 邮箱登录与“系统浏览器设置密码”入口；内嵌 Google OAuth 已撤销。
- Pixiv 作品图片在显示前进行本地元素审查。
- 进程内 URL 去重、串行模型队列、临时文件清理和实时统计。
- 网络级广告/追踪域名拦截、非 Pixiv 第三方 iframe 默认拒绝。

## 最近实机证据

公开排行榜 `https://www.pixiv.net/ranking.php?mode=daily`：

```text
作品图片：6
完成本地审查并实际加载：6
内容拦截：0
广告/追踪请求拦截：37
第三方 iframe 调试目标：0
总调试目标：3
```

在加入广告策略前，同一页面会创建多组广告竞价 iframe 和 Electron 渲染进程。

## 用户刚报告的内容

此前页面出现带“PR”字样的 Pixiv 漫画推广卡片。这是 Pixiv 第一方广告：资源和 DOM 都来自 Pixiv 自有域名，因此网络域名拦截不会处理它。当前已由页面级 DOM 适配器处理。

结论：应该拦截，但必须加入页面级美容过滤，隐藏整张 PR 卡片；不得把“PR”图片当作元素黑名单命中，也不得封禁 Pixiv 自有域名。

## 当前限制

- 远程审查缓存已持久化；缓存键包含规范化 URL、引擎、引擎版本和规则指纹。
- 审查会先下载临时副本，放行后页面再次下载原图，存在双重网络流量。
- WD Tagger 首次加载和逐张推理仍有可感知等待。
- 被拦截作品现在显示本地浅色占位层、命中原因和“仅本次查看”按钮；一次性查看不会写入永久 allow 缓存。
- 视频继续默认拦截。
- 第一方 PR/推广卡片已由页面级 DOM 适配器隐藏，统计与网络广告拦截分开。

## 日常命令

```powershell
npm.cmd run typecheck
.\node_modules\.bin\vitest.cmd run
& 'E:\PIxiv\.venv\Scripts\python.exe' -m unittest discover -s 'E:\PIxiv\services\vision\python' -p 'test_*.py'
npm.cmd run build
```

运行构建版：双击 `E:\PIxiv\启动纯净领域.cmd`。修改构建输出后，必须关闭旧应用进程再重新启动。

## 不要做

- 不要重新加入内嵌 Google 登录、UA 伪装或 `navigator.webdriver` 伪装。
- 不要复制系统浏览器 Cookie。
- 不要为了显示图片而在审查完成前直接放开所有 `image` 请求。
- 不要提交 `node_modules/`、`.venv/`、`models/`、`.tmp/`、构建输出或应用数据库。
