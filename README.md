# 纯净领域（Digital Sanctuary）

> [!WARNING]
> **测试版本，请不要随便下载使用。**
> 这是个人项目的开发中版本，功能和数据格式随时会变，没有稳定的安装包，也不保证升级后旧数据可用。仓库公开只是为了方便查看代码，不提供支持。

本地二次元图片库。本地模型帮你把收藏的图找出来、用起来；逛 Pixiv 时顺手避雷、收图。

- **找**：按名称、按画面（用中文描述）、按元素标签、找相似图；任何筛选或搜索结果都能存成相册。
- **用**：选中几张图拿去创作，和本地视觉模型聊图、反推提示词，或交给本机 ComfyUI 出图。
- **进**：内置浏览器逛 Pixiv，本地模型先审查画面，命中不想看的内容就遮挡；作品和收藏可以直接存进图库。

所有图片和模型都在本机，不上传。

## 怎么用

左侧图标栏：

| 入口 | 做什么 |
|---|---|
| **图库** | 作品 / 相册 / 画师。一个搜索框：“按画面”用中文描述找图，“按名称”搜标题、画师、Pixiv ID；筛选里可按元素包含或排除。右键作品可找相似图、改名、加入相册；多选后可“拿去创作”。 |
| **探索** | 内置浏览器。Pixiv 页面先审查后显示，可“保存作品”或“下载全部收藏”；其他网站在图片上右键“加入图库”。 |
| **创作** | 带着参考图和本地视觉模型聊图、整理提示词；回答可以“拿去出图”。 |
| 底部 | 快捷操作（Ctrl+K）、任务与进度、浏览保护状态、设置。 |

大图：← / → 翻页，滚轮缩放，Esc 退出；右上角“…”里有找相似图、读图、带着这张图去创作。

快捷键：Ctrl+K 快捷操作，Ctrl+F 搜索图库，Ctrl+O 导入，Ctrl+0 开始，Ctrl+1/2/3/4 图库 / 探索 / 创作 / 设置。

模型在“设置 → 模型管理”里下载：按画面找图用 EmbeddingGemma 2，元素识别用 WD Tagger，读图和聊图用视觉模型。

## 本地运行

要求：Windows、Node.js 24+。

```powershell
npm.cmd install
npm.cmd run vision:install
npm.cmd run dev
```

日常也可以直接双击 `启动纯净领域.cmd`（先构建最新源码再启动）。若 `node_modules\electron\dist\electron.exe` 缺失：`node .\node_modules\electron\install.js`。

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

- [`AGENTS.md`](AGENTS.md)：定位与项目规范（所有开发者与智能体共用）。
- [`docs/plans/ACTIVE_ROADMAP.md`](docs/plans/ACTIVE_ROADMAP.md)：当前路线。
- [`ARCHITECTURE.md`](ARCHITECTURE.md)：架构、信任边界与安全不变量。
- [`docs/design/PRODUCT_PRINCIPLES.md`](docs/design/PRODUCT_PRINCIPLES.md)：交互原则。
- `docs/known-issues/`、`docs/operations/`、`docs/research/`、`docs/adr/`：已知问题、运维、模型探针、架构决策。
- `docs/plans/archive/`、`docs/reviews/`：历史计划与验收记录，仅供追溯。

## 许可证

[MIT](LICENSE)。Pixiv 是 pixiv Inc. 的商标，本项目与其无关。模型文件由应用从各自的官方来源下载，遵循各自的许可证。
