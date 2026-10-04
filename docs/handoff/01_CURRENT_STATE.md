# 交接一：当前状态

- 最新工作流补充：2026-10-04（历史基础记录保留）
- 工作区：`E:\PIxiv`
- 当前基线：本文件所在提交；导入、作品信息、保存筛选与统一任务入口已完成，未重打安装包。
- 平台：Windows
- 桌面框架：Electron 43.3.0 + React 19 + TypeScript
- Python：3.14.6
- 视觉引擎：WD SwinV2 Tagger v3 + ONNX Runtime 1.28.0

## 接手前必读

本轮整合的入口和边界见 README“从哪里开始”及 `docs/plans/archive/2026-10-04-serpent-workflow-adoption-complete.md`。425 项 TS、9 项 Python、完整类型与构建、57 组导航及 17 组查看器窗口检查通过。导入和查看信息不自动启动模型，外部原文件保留；一般筛选保存在 SQLite 偏好，任务页使用轻量摘要，不全库读取。导入/下载/补图状态为会话级，批量识别沿用原有持久任务。

按顺序阅读：

1. `Project_Vision.md`
2. `AI_Filtering_Strategy.md`
3. `ARCHITECTURE.md`
4. `docs/plans/ACTIVE_ROADMAP.md`
5. `docs/handoff/02_VERIFICATION_CHECKLIST.md`
6. `docs/known-issues/README.md`

不要根据旧草稿恢复年龄分级过滤。项目过滤的是用户不欢迎的画面元素；正常 R18 不是默认拦截目标。

## 已完成的产品闭环

### 桌面与安全边界

- Electron + React 桌面外壳、现代化二次元极简设计系统（Design Tokens）、单实例锁和便捷启动脚本。
- 沙箱化 Pixiv `WebContentsView` 使用独立持久化 `persist:pixiv` session。
- 顶层导航、弹窗、权限和下载默认拒绝；远程页面不能访问本地文件、SQLite 或通用 IPC。
- Pixiv 邮箱登录可用；内嵌 Google OAuth、UA/`webdriver` 伪装和系统浏览器 Cookie 复制均已撤销。

### 探索审查

- WD Tagger Python 子进程、版本化 JSON Lines 协议、元素黑名单规则和失败闭合。
- Pixiv 作品图片在显示前进行本地元素审查；站点 UI、头像和登录素材不进入模型。
- 进程内去重、严格单路模型队列、SQLite 持久审查缓存和 30 天/2,000 条清理策略。
- 被拦截图片显示浅色占位层、命中原因和受限的“仅本次查看”；一次性查看不写入永久缓存。
- 网络级广告/追踪域名拦截和非 Pixiv 第三方 iframe 默认拒绝仍启用。
- 探索顶栏配备高科技感防线雷达 HUD（放行绿 / 拦截红 / 广告黄 / 缓存紫 / 审查中蓝彩色状态指示）。
- 视口驱动审查 preload 与优先队列代码保留，但因 KI-0004 默认关闭；当前生产路径是同步网络审查。

### Pixiv 下载

- 作品详情页可保存当前作品的全部页面，网页内也有“保存到本地画廊”按钮。
- 收藏页可预览数量并分页读取公开/非公开收藏，再一键下载全部作品。
- Pixiv AJAX、作品 ID、原图 URL、扩展名和响应类型均经过严格校验。
- 原图使用四路限流、流式临时文件和原子改名，保存到“图片/Digital Sanctuary/Pixiv/作品 ID”；已存在文件跳过网络下载。
- 收藏作品按顺序处理，Pixiv JSON API 至少间隔 800 ms；全局限流/网络/服务异常在有界重试后停止整批，连续 5 个作品失败也会熔断。
- 所有用户主动下载都默认可信：清除旧 AI assessment，保存明确 `allow`，不自动运行模型。
- 作者 ID、作者名、作品标题、作品 ID 和页码写入 SQLite；重复下载会去重并补齐元数据。

### 本地画廊

- 手工导入图片、SQLite 索引、分类、分类组合视图（Saved Views）和元素规则页面可用。
- 原图通过受限 `sanctuary-image` 协议展示，只有数据库已索引且仍存在的文件路径可以读取。
- 顶部支持影院级 Ambient Hero 动态氛围横幅；卡片支持多页作品相纸堆叠（Stack Effect）视觉与悬浮升降。
- 作品级网格每页 60 条自动续载，`content-visibility: auto` 跳过屏幕外绘制，10,000 作品极速加载。
- 支持传统平铺和“作者封面墙 → 作者作品页 → 同作品多页”两级浏览。
- 支持分类封面墙、点击进入分类详情页及从分类内容中选择封面。
- 支持“分类组合 / 组合视图（Saved Views）”：多选包含（AND / OR）、排除（NOT）虚拟筛选，拼贴封面，防抖实时匹配预览与画廊组合条件摘要栏，不触碰原物理文件与分类实体。
- 作者头像只从应用托管的本地缓存展示；远程热链失败时回退为作者首字母。
- 点击图片进入沉浸式大图层，配备深邃暗调背景舞台与悬浮磨砂玻璃控制台；同作品可用左右按钮或方向键翻页，`Esc`/背景点击关闭。
- 清晰作品不显示“已放行”覆盖徽章；仅模糊、隐藏或分析异常显示状态。

### 性能基线

- RTX 4050 CUDA 独立环境已验证，开发启动优先 `.venv-gpu`，失败回退 CPU。
- 固定输入基准：CPU 中位数约 463 ms，CUDA 中位数约 72 ms，约 6.45 倍加速。
- 下载网络并发为 4；视觉推理仍保持单路，不能因为有 GPU 就盲目提高并发。

### 发布与恢复

- SQLite schema 版本为 `3`（包含 `saved_collection_views` 表）；设置页可用 `VACUUM INTO` 创建一致性数据库备份，恢复步骤见 `docs/operations/BACKUP_AND_RECOVERY.md`。
- `npm.cmd run dist:win` 生成带 DS 图标、CPU WD Tagger、自包含 Python 运行时和模型的 NSIS 安装包。
- `npm.cmd run smoke:installer` 在隔离目录完成安装、生产 UI、导航可访问性状态、真实 WD Tagger 推理、卸载和清理验收。
- 安装包当前没有商业代码签名证书；向他人分发前需确认模型/第三方依赖许可并处理 Windows 发布者信誉。

## 当前限制与冻结项

- `styles.css` 已收敛为有序清单，实际规则按设计令牌、应用壳、共享组件、画廊、探索、设置、分析、响应式和分类组合等 21 个模块维护；Vite 在内存中将它们合成单一虚拟 CSS 入口，禁止渲染代码直接逐个导入。分类组合的 IPC 与 SQLite store 也已从主进程/数据库总类抽离并有独立测试。
- 主题后端已经打通：`ThemeManifest`、内置/用户主题发现、活跃主题偏好、文件夹/ZIP 导入、原子更新、删除回退、GitHub Contents API 商店、30 分钟持久缓存、限流熔断、IPC 与 Preload 类型均已完成。渲染层仍需实现 `<style id="ds-dynamic-theme">` 注入和主题管理/商店界面，接口见 `03_THEME_BACKEND_API.md`。
- `apps/desktop/src/main/index.ts` 仍包含探索、下载和视觉生命周期协调；后续应继续按现有计划小步抽离，但分类组合等新功能不得再直接向组合根追加整套 CRUD。
- 同步探索审查会暂停图片网络回调，未命中缓存时还存在“审查副本 + 页面重新下载”的双重流量和滚动等待。
- 视口驱动实验不得直接重新开启；必须先用本地 HTML fixture 覆盖 preload 启动、候选 IPC、结果回传和图片重载。
- 第一方 PR/BOOTH 美容过滤冻结。旧的宽泛 DOM 猜测会把普通作品列表整块隐藏；当前依赖 Pixiv Premium 官方广告设置，网络级过滤继续保留。
- 画廊已有版本化 `v1` 缩略图缓存、每页 60 条渐进加载和屏幕外绘制跳过；真实 Electron 10,000 作品基准命令为 `npm.cmd run benchmark:library`。
- 本地“模型整理”已实现为显式任务中心：范围预览、串行任务、取消、缓存、异常恢复和二次确认分类均与下载信任分离。
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
