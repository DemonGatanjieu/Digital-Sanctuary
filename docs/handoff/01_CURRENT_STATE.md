# 交接一：当前状态

- 交接日期：2026-08-11
- 工作区：`E:\PIxiv`
- 当前基线提交：`36600de feat: complete trusted Pixiv library stage`
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

不要根据旧草稿恢复年龄分级过滤。项目过滤的是用户不欢迎的画面元素；正常 R18 不是默认拦截目标。

## 已完成的产品闭环

### 桌面与安全边界

- Electron + React 桌面外壳、浅色默认主题、单实例锁和便捷启动脚本。
- 沙箱化 Pixiv `WebContentsView` 使用独立持久化 `persist:pixiv` session。
- 顶层导航、弹窗、权限和下载默认拒绝；远程页面不能访问本地文件、SQLite 或通用 IPC。
- Pixiv 邮箱登录可用；内嵌 Google OAuth、UA/`webdriver` 伪装和系统浏览器 Cookie 复制均已撤销。

### 探索审查

- WD Tagger Python 子进程、版本化 JSON Lines 协议、元素黑名单规则和失败闭合。
- Pixiv 作品图片在显示前进行本地元素审查；站点 UI、头像和登录素材不进入模型。
- 进程内去重、严格单路模型队列、SQLite 持久审查缓存和 30 天/2,000 条清理策略。
- 被拦截图片显示浅色占位层、命中原因和受限的“仅本次查看”；一次性查看不写入永久缓存。
- 网络级广告/追踪域名拦截和非 Pixiv 第三方 iframe 默认拒绝仍启用。
- 视口驱动审查 preload 与优先队列代码保留，但因 KI-0004 默认关闭；当前生产路径是同步网络审查。

### Pixiv 下载

- 作品详情页可保存当前作品的全部页面，网页内也有“保存到本地画廊”按钮。
- 收藏页可预览数量并分页读取公开/非公开收藏，再一键下载全部作品。
- Pixiv AJAX、作品 ID、原图 URL、扩展名和响应类型均经过严格校验。
- 原图使用四路限流、流式临时文件和原子改名，保存到“图片/Digital Sanctuary/Pixiv/作品 ID”；已存在文件跳过网络下载。
- 所有用户主动下载都默认可信：清除旧 AI assessment，保存明确 `allow`，不自动运行模型。
- 作者 ID、作者名、作品标题、作品 ID 和页码写入 SQLite；重复下载会去重并补齐元数据。

### 本地画廊

- 手工导入图片、SQLite 索引、分类和元素规则页面可用。
- 原图通过受限 `sanctuary-image` 协议展示，只有数据库已索引且仍存在的文件路径可以读取。
- 原图采用视口懒加载和离屏渲染跳过，不生成降质缩略图。
- 支持传统平铺和“作者封面墙 → 作者作品页 → 同作品多页”两级浏览。
- 点击图片进入沉浸式大图层；同作品可用左右按钮或方向键翻页，`Esc`/背景点击关闭。
- 清晰作品不显示“已放行”覆盖徽章；仅模糊、隐藏或分析异常显示状态。

### 性能基线

- RTX 4050 CUDA 独立环境已验证，开发启动优先 `.venv-gpu`，失败回退 CPU。
- 固定输入基准：CPU 中位数约 463 ms，CUDA 中位数约 72 ms，约 6.45 倍加速。
- 下载网络并发为 4；视觉推理仍保持单路，不能因为有 GPU 就盲目提高并发。

## 当前限制与冻结项

- `apps/desktop/src/main/index.ts` 已超过合理组合根体积，同时包含探索、下载、图库和视觉生命周期；下一轮功能稳定后需要按边界小步拆分。
- 同步探索审查会暂停图片网络回调，未命中缓存时还存在“审查副本 + 页面重新下载”的双重流量和滚动等待。
- 视口驱动实验不得直接重新开启；必须先用本地 HTML fixture 覆盖 preload 启动、候选 IPC、结果回传和图片重载。
- 第一方 PR/BOOTH 美容过滤冻结。旧的宽泛 DOM 猜测会把普通作品列表整块隐藏；当前依赖 Pixiv Premium 官方广告设置，网络级过滤继续保留。
- 画廊没有缩略图缓存。当前选择保真原图 + 懒加载；只有实测仍表明大图库首屏或滚动成本不可接受时再决定缩略图方案。
- 本地“模型整理”尚未实现。不得通过恢复下载后自动审查来冒充该功能。
- 视频仍默认拦截。

## 日常命令

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

运行构建版：双击 `E:\PIxiv\启动纯净领域.cmd`。修改构建输出后，必须关闭旧应用进程再重新启动。

## 不要做

- 不要恢复年龄分级过滤、内嵌 Google 登录、浏览器指纹伪装或 Cookie 复制。
- 不要为了显示图片而在远程审查完成前放开所有作品图请求。
- 不要让远程 Pixiv 页面直接获得文件路径、SQLite 或通用 Electron API。
- 不要让模型整理覆盖主动下载作品的用户信任决策。
- 不要恢复基于 `PR` 文本或祖先层级的宽泛 DOM 广告猜测。
- 不要提交 `node_modules/`、`.venv*`、`models/`、`.tmp/`、构建输出、应用数据库或登录 session。
