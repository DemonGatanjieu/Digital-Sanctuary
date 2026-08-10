# 纯净领域（Digital Sanctuary）

一个本地优先的二次元图片管理与安全浏览桌面应用。当前仓库已经完成路线 A 的第一条技术纵向切片：本地图片导入、SQLite 索引、视觉子进程协议、规则判定、隐藏/模糊呈现和分类关系。

## 当前状态

- Electron + React + TypeScript 桌面外壳可构建、可启动。
- 图片只建立索引，不移动或修改原文件。
- SQLite 数据保存在系统应用数据目录，不进入源码仓库。
- 视觉服务作为独立子进程运行，具有版本化 JSON Lines 协议、超时与失败闭合行为。
- 当前优先使用 Python 3.14 + WD SwinV2 Tagger v3 + ONNX Runtime 1.28.0 进行本地多标签推理；模型或虚拟环境缺失时才回退到 `filename-probe` 开发探针。
- 过滤只比较用户不欢迎的元素标签，不使用 `general / sensitive / questionable / explicit` 年龄分级结果。
- 当前内置猎奇、血腥、断肢和 WD Tagger 可覆盖的小便相关标签组；可在“规则”页面按组开关、调整阈值并持久化，阈值仍需用本地二次元评测集校准。
- “探索”页面已使用独立、沙箱化的 WebContentsView 加载 Pixiv，并限制顶层导航、权限、弹窗和下载。
- 探索模式使用沉浸式全内容区布局，提供 Pixiv 邮箱登录、默认浏览器中的官方密码设置入口和窗口最大化控制；第三方 OAuth 不在 Electron 内嵌页面中运行。
- 探索页会识别 Pixiv 作品 CDN 图片，在原始请求发出前下载临时副本交给本地 WD Tagger；未命中元素黑名单才放行，命中、超时或下载失败都保持遮挡。站点图标、头像和登录素材不进入作品审查队列，视频仍默认拦截。
- 探索 session 自带网络级广告拦截，不依赖 Chrome/Edge 扩展：常见广告与追踪域名直接取消，非 Pixiv 第三方 iframe 默认拒绝，Pixiv 登录所需的 reCAPTCHA 保留。
- 应用启用 Electron 单实例锁；重复启动只唤醒已有窗口，Pixiv 使用持久化 `persist:pixiv` session，正常情况下无需每次重新登录。
- 探索页已加入 Pixiv 第一方 PR/推广卡片美容过滤：使用页面级 DOM 适配器和幂等 `MutationObserver` 隐藏整张推广卡片，并与网络广告统计分开。
- 远程图片审查结果已持久化到 SQLite；缓存键包含规范化 URL、引擎、引擎版本和稳定规则指纹。只有完整结果会缓存，规则变化、模型变化或缓存过期会自动失效。
- 桌面外壳默认使用接近 Pixiv 阅读体验的浅色设计：白色导航、浅灰内容区和低饱和蓝色交互。

## 下一步

被拦截作品现在显示统一浅色占位卡片和命中原因；用户可以对单张作品执行受限的“仅本次查看”，该操作只放行一次请求，不写入永久缓存。下一阶段转向视觉引擎 ready/health、分段耗时和已审查字节复用。

## 本地运行

要求：Windows、Node.js 24 或更新版本。

日常启动可直接双击根目录的 `启动纯净领域.cmd`。开发模式使用：

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
- `Implementation_Plan_Options.md`：三条实施路线及止损条件。
- `Project_Structure_Plan.md`：目录与依赖边界。
- `docs/adr/`：已经确定的首版架构决策。
- `docs/research/`：模型与安全浏览技术探针结论。
- `docs/known-issues/`：已确认、暂不阻塞推进的问题与临时处理。
- `ARCHITECTURE.md`：当前架构、安全不变量与目标模块拆分。
- `docs/handoff/`：供后续开发者或代码模型继续实现的状态、计划和验收清单。
