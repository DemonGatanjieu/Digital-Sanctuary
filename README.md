# 纯净领域（Digital Sanctuary）

一个本地优先的二次元图片管理与安全浏览桌面应用。当前仓库已经跑通“Pixiv 探索 → 元素审查 → 主动下载 → 本地画廊”的首个完整产品闭环。

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
- SQLite 会保存 Pixiv 作者、作品、标题、页码、可选本地头像和分类封面；作者头像通过独立作者资料接口获取，“作者 · 作品”模式可显式补全旧记录。画廊支持原图懒加载、传统平铺、可点击分类、“作者封面墙 → 作者作品页”两级浏览及同作品大图翻页。
- 第一方 PR/BOOTH 美容过滤当前冻结：旧的宽泛 DOM 猜测会误伤普通作品，不能恢复；网络级广告规则继续保留。
- RTX 4050 开发环境可优先使用 CUDA，初始化失败自动回退 CPU；固定基准中单图推理中位数约从 463 ms 降至 72 ms。
- 桌面外壳默认使用接近 Pixiv 阅读体验的浅色设计：白色导航、浅灰内容区和低饱和蓝色交互。

## 下一步

下一阶段进入 2.0 产品化重构：先把页面级图库升级为“作品 → 多页资产”模型，完成搜索、排序、多选、安全删除、分类管理、窗口偏好和缩略图管线，再实现显式模型整理。产品设计见 `docs/design/`，施工顺序见 `docs/plans/ACTIVE_ROADMAP.md`。

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

## 设计文档

- `Project_Vision.md`：产品愿景。
- `docs/plans/ACTIVE_ROADMAP.md`：唯一现行实施路线。
- `docs/plans/archive/`：已结束的路线比较、启动草稿和建仓前目录设想，仅供追溯。
- `docs/adr/`：已经确定的首版架构决策。
- `docs/research/`：模型与安全浏览技术探针结论。
- `docs/known-issues/`：已确认、暂不阻塞推进的问题与临时处理。
- `ARCHITECTURE.md`：当前架构、安全不变量与目标模块拆分。
- `docs/handoff/`：供后续开发者或代码模型继续实现的当前状态和验收清单。
