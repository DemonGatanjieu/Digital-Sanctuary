# 纯净领域（Digital Sanctuary）

一个本地优先的二次元图片管理与安全浏览桌面应用。当前仓库已经跑通“Pixiv 探索 → 元素审查 → 主动下载 → 本地画廊”的首个完整产品闭环。

## 从哪里开始

- **图库**：导入本地图片，按全部作品、相册或画师浏览；用“喜欢 / 最近浏览 / 未分相册”快速找图，在“整理与分类”中按标签查找或获取相册分类建议。
- **探索**：浏览 Pixiv，在作品详情保存全部页，或在收藏页预览并下载收藏。
- **创作**：加入图库中的参考图，与本地模型聊图、写设定或整理提示词；回答或整段对话可以复制、保存为 Markdown。没有创作模型时可直接进入安装页。
- **设置**：按“图库与存储 / 外观与显示 / 探索保护 / 本地模型 / 外部连接”配置；基础使用无需先配置外部服务。

从图库多选作品后点击“推荐相册分类…”会带着选中范围进入建议页，只有预览并确认后才运行分析。详细整合记录见 [用户操作路径审核](docs/reviews/2026-10-03-user-workflows.md)。

按 **Ctrl+K** 或侧栏“快捷操作”，输入「导入」「喜欢」「最近」「相册」「模型」即可直达对应操作；探索网页内也能打开。**Ctrl+F** 搜索图库，**Ctrl+O** 导入，**Ctrl+1 / 2 / 3 / 4** 分别进入图库、探索、创作、设置。弹窗和大图开启时，键盘操作归当前窗口。

大图支持 **← / →** 翻页、**Home / End** 首末页、**1** 查看原始像素、**0 / R** 适应窗口、**+ / −** 缩放；滚轮围绕鼠标位置缩放，**Esc** 从最上层抽屉逐层退出。图库返回会保留已加载范围和滚动位置。性能改动与实测范围见 [流畅体验审核](docs/reviews/2026-10-03-smooth-experience.md)。

作品封面会从上次成功读到的页继续，直接点某一页则从该页开始；最多保存最近 100 件作品的阅读位置。“最近浏览”按打开时间排序，切回其他筛选会恢复原来的排序。阅读位置只用于本地续读，不参与模型分析或偏好学习。

创作页在最小窗口保留输入区域；长回答在消息区内部滚动。输出、续读与状态修复的范围见 [日常图库与创作审核](docs/reviews/2026-10-03-everyday-library-and-creation.md)。

## 当前状态

- Electron + React + TypeScript 桌面外壳可构建、可启动。
- 手动导入的既有图片只建立索引，不移动或修改原文件；从 Pixiv 主动保存的作品由应用托管到用户图片目录。
- SQLite 数据保存在系统应用数据目录，不进入源码仓库。
- 视觉服务作为独立子进程运行，具有版本化 JSON Lines 协议、超时与失败闭合行为。
- 当前优先使用 Python 3.14 + WD SwinV2 Tagger v3 + ONNX Runtime 1.28.0 进行本地多标签推理；模型或虚拟环境缺失时才回退到 `filename-probe` 开发探针。
- 过滤只比较用户不欢迎的元素标签，不使用 `general / sensitive / questionable / explicit` 年龄分级结果。
- 当前内置猎奇、血腥、断肢和 WD Tagger 可覆盖的小便相关标签组；可在“规则”页面按组开关、调整阈值并持久化，阈值仍需用本地二次元评测集校准。
- “探索”页面已使用独立、沙箱化的 WebContentsView 加载 Pixiv，并限制顶层导航、权限、弹窗和下载。
- 探索模式保留精简应用侧栏并让 Pixiv 填满剩余区域，提供 Pixiv 邮箱登录、默认浏览器中的官方密码设置入口和窗口最大化控制；第三方 OAuth 不在 Electron 内嵌页面中运行。
- 探索页会识别 Pixiv 作品 CDN 图片，在原始请求发出前下载临时副本交给本地 WD Tagger；未命中元素黑名单才放行，命中、超时或下载失败都保持遮挡。站点图标、头像和登录素材不进入作品审查队列，视频仍默认拦截。
- 探索 session 自带网络级广告拦截，不依赖 Chrome/Edge 扩展：常见广告与追踪域名直接取消，非 Pixiv 第三方 iframe 默认拒绝，Pixiv 登录所需的 reCAPTCHA 保留。
- 应用启用 Electron 单实例锁；重复启动只唤醒已有窗口，Pixiv 使用持久化 `persist:pixiv` session，正常情况下无需每次重新登录。
- 远程图片审查结果已持久化到 SQLite；缓存键包含规范化 URL、引擎、引擎版本和稳定规则指纹。只有完整结果会缓存，规则变化、模型变化或缓存过期会自动失效。
- 作品详情页可保存完整多页作品，收藏页可分页下载公开与非公开收藏。收藏作品按顺序处理，Pixiv API 全局间隔至少 800 ms；429、网络异常和 5xx 只做两次有上限的重试，仍失败便停止整批任务，连续 5 个普通作品失败也会熔断，避免再次出现数百项连锁失败。已完整索引且作者资料存在的作品走本地快速跳过。
- 用户主动下载的 Pixiv 作品默认视为可信：清除旧 AI 判定并直接进入画廊，不自动运行模型。探索页展示仍保持自动审查和失败闭合，两条信任边界互不混用。
- SQLite 会保存 Pixiv 作者、作品、标题、页码、可选本地头像、分类封面及分类组合视图（`saved_collection_views` 表，版本 3 迁移）；作者头像通过独立作者资料接口获取，“作者 · 作品”模式可显式补全旧记录。画廊支持原图懒加载、传统平铺、普通分类、分类组合视图（AND / OR / NOT 虚拟布尔筛选）、“作者封面墙 → 作者作品页”两级浏览及同作品大图翻页。
- 第一方 PR/BOOTH 美容过滤当前冻结：旧的宽泛 DOM 猜测会误伤普通作品，不能恢复；网络级广告规则继续保留。
- RTX 4050 开发环境可优先使用 CUDA，初始化失败自动回退 CPU；固定基准中单图推理中位数约从 463 ms 降至 72 ms。
- 桌面外壳采用二次元现代极简设计系统（Design Tokens）：影院级 Ambient Hero 氛围横幅、多页作品相纸堆叠（Stack Effect）视觉、悬浮控制台、探索防线雷达 HUD，并持久化精致 / 均衡 / 省电三档性能策略。

## 当前产品化阶段

2.0 路线中的作品级图库、搜索排序、多选、安全删除、分类管理、分类组合视图（Saved Views）、窗口与显示偏好、版本化缩略图、10,000 作品基准、自定义元素组、显式模型整理及 UI/UX 现代化设计系统重构均已落地。当前发布收尾与后续维护以 `docs/plans/ACTIVE_ROADMAP.md` 为准。

## 本地运行

要求：Windows、Node.js 24 或更新版本。

日常启动可直接双击根目录的 `启动纯净领域.cmd`。启动器会先构建最新源码；如果旧窗口仍在运行，它会要求先关闭旧窗口，避免误以为修改没有生效。开发模式使用：

```powershell
npm.cmd install
npm.cmd run vision:install
npm.cmd run dev
```

Electron 43 将运行时下载器作为显式脚本提供；根目录的 `postinstall` 已负责执行它。如果依赖存在但 `node_modules\electron\dist\electron.exe` 缺失，可运行：

```powershell
node .\node_modules\electron\install.js
```

## 检查

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Python 视觉单测也可以单独运行：

```powershell
& 'E:\PIxiv\.venv\Scripts\python.exe' -m unittest discover -s 'E:\PIxiv\services\vision\python' -p 'test_*.py'
```

构建输出位于 `apps\desktop\out`，它是可重新生成的开发产物，不进入版本控制。

## Windows 安装包

安装视觉构建依赖一次：

```powershell
& '.\.venv\Scripts\python.exe' -m pip install -r '.\services\vision\python\requirements-build.txt'
```

生成带 CPU WD Tagger、自包含 Python 运行时和模型文件的 NSIS 安装包：

```powershell
npm.cmd run dist:win
npm.cmd run smoke:installer
```

产物位于 `release\Digital-Sanctuary-Setup-0.1.0.exe`。安装、启动、模型资源、模型整理页、卸载和临时目录清理均由 `smoke:installer` 在隔离目录验证。当前未配置商业代码签名证书；首次分发时 Windows 可能显示未知发布者提示。

## 设计文档

- `Project_Vision.md`：产品愿景。
- `docs/plans/ACTIVE_ROADMAP.md`：唯一现行实施路线。
- `docs/plans/archive/`：已结束的路线比较、启动草稿和建仓前目录设想，仅供追溯。
- `docs/adr/`：已经确定的首版架构决策。
- `docs/research/`：模型与安全浏览技术探针结论。
- `docs/known-issues/`：已确认、暂不阻塞推进的问题与临时处理。
- `docs/operations/`：数据库备份、恢复与发布操作。
- `ARCHITECTURE.md`：当前架构、安全不变量与目标模块拆分。
- `docs/handoff/`：供后续开发者或代码模型继续实现的当前状态和验收清单。
