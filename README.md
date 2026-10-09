# 纯净领域（Digital Sanctuary）

本地优先的二次元图片管理与安全浏览桌面应用：把喜欢的图收进本地图库，按作品、相册和画师浏览；浏览 Pixiv 时，本地模型先识别画面元素，命中你不想看的内容就遮挡。

## 怎么用

左侧图标栏是全部入口：

| 入口 | 做什么 |
|---|---|
| **图库** | 默认打开。一行工具条：作品 / 相册 / 画师，一个搜索框（“按画面”用中文描述找图，回车开始；“按名称”搜标题、画师、Pixiv ID），筛选、排序、选择、导入。图片按原比例排列；悬停看标题和喜欢，右键可改名、复制、加入相册、在文件夹中显示，直接拖动图片即可拖出原图。 |
| **整理** | 从图库或本地文件夹批量找图、按探索规则排查、加入相册或复制原图。 |
| **探索** | 内置浏览器。Pixiv 页面先审查后显示，可“保存作品”或“下载全部收藏”；其他网站在图片上右键“加入图库”。 |
| **创作** | 带着参考图与本地视觉模型聊图、写设定、整理提示词。 |
| 底部 | 快捷操作（Ctrl+K）、任务与进度、浏览保护状态、设置。左上角标志回到“开始”页。 |

大图：← / → 翻页，Home / End 首末页，1 原始像素，0 适应窗口，滚轮缩放，Esc 逐层退出；右上角 ⓘ 打开作品信息，“…”里有元素与提示词、画像与画评、带图创作。

快捷键：Ctrl+K 快捷操作，Ctrl+F 搜索图库，Ctrl+O 导入，Ctrl+0 开始，Ctrl+1/2/3/4 图库 / 探索 / 创作 / 设置。

界面默认跟随系统浅色 / 深色，也可以在设置 → 外观与显示里固定为浅色或深色。

## 本地运行

要求：Windows、Node.js 24+。日常可直接双击 `启动纯净领域.cmd`（先构建最新源码再启动）。开发：

```powershell
npm.cmd install
npm.cmd run vision:install
npm.cmd run dev
```

若 `node_modules\electron\dist\electron.exe` 缺失：`node .\node_modules\electron\install.js`。

自然语言找图使用开发工作区的 [EmbeddingGemma 2 独立环境](services/semantic/README.md)；视觉对话模型在设置 → 模型管理中安装。

## 检查

```powershell
npm.cmd run verify                         # 类型检查 + Vitest + Python 单测 + 生产构建
node scripts/ui-snapshots.mjs <标签>        # 隔离图库截图（浅/深色、1280/900），对比 .tmp/ui-snapshots/
node scripts/smoke-gallery-actions.mjs      # 端到端冒烟（另有 viewer、navigation、gallery-* 等）
```

## Windows 安装包

```powershell
& '.\.venv\Scripts\python.exe' -m pip install -r '.\services\vision\python\requirements-build.txt'   # 一次
npm.cmd run dist:win
npm.cmd run smoke:installer
```

产物在 `release\`。未配置代码签名，首次运行 Windows 可能提示未知发布者。旧版升级与图片迁移见 [UPGRADE_AND_STORAGE_MIGRATION](docs/operations/UPGRADE_AND_STORAGE_MIGRATION.md)。

## 文档

- [`AGENTS.md`](AGENTS.md)：项目规范（所有开发者与智能体共用）。
- [`docs/design/IMAGE_FIRST_REDESIGN.md`](docs/design/IMAGE_FIRST_REDESIGN.md)：当前路线与已定设计决策。
- [`ARCHITECTURE.md`](ARCHITECTURE.md)：架构、信任边界与安全不变量。
- [`docs/design/PRODUCT_PRINCIPLES.md`](docs/design/PRODUCT_PRINCIPLES.md)：交互原则。
- `docs/known-issues/`、`docs/operations/`、`docs/research/`、`docs/adr/`：已知问题、运维、模型探针、架构决策。
- `docs/plans/archive/`、`docs/reviews/`：历史计划与验收记录，仅供追溯。
