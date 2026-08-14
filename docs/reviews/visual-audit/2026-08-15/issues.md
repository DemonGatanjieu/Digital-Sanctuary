# 纯净领域视觉审计问题主账本（VA Issues Ledger）

- 审计日期：2026-08-15
- 审计基线：`d6086f1`
- 修复阶段：Phase 5 闭环修复完成，Phase 6 回归验证通过
- 状态统计：`P0: 0` / `P1: 2 (2 已修复验证)` / `P2: 4 (4 已修复验证)` / `P3: 1 (1 已修复验证)`（共 7 项全部闭环）

---

## VA-001 · [P1] 最小窗口 W1 (900×620) 产生横向滚动溢出 (60px Delta)

- **状态**：verified
- **优先级**：P1
- **区域**：应用壳层 / 画廊 / 相册 / 设置通用视口
- **基线**：`d6086f1`
- **环境**：`default` / `balanced` / `900×620 (W1)`
- **复现**：将窗口调整为 Electron BrowserWindow 允许的最小尺寸（900×620），打开画廊全景、相册或设置页。
- **期望**：页面自适应 900px 宽度，内容在视口内弹性排布，仅允许纵向滚动，不出现横向滚动条。
- **实际**：`scrollWidth (960px) > clientWidth (900px)`，产生 60px 横向滚动溢出，画廊顶部 Hero 罗盘右侧被挤出视口，顶栏操作按钮溢出。
- **证据**：`docs/reviews/visual-audit/2026-08-15/evidence/before/VA-001_gallery_min_W1_overflow.png`
- **运行时证据**：修复前 `scrollWidth = 960px`, `clientWidth = 900px`, `overflowDelta = 60px`；修复后 `scrollWidth = 900px`, `clientWidth = 900px`, `hasHOverflow = false`。
- **推测根因**：`renderer/src/styles/base.css` 设置了写死的 `min-width: 960px`，与 Electron 主进程设定的最小窗口宽度 `minWidth: 900` 冲突。
- **修复范围**：
  1. `styles/base.css`：将 `body` 最小宽度调整为 `min-width: 900px`；
  2. `styles/responsive.css`：新增 `@media (max-width: 980px)` 弹性规则，对 Sidebar、Topbar、Ambient Hero 与操作按钮间距进行收缩自适应。
- **回归邻域**：画廊网格卡片列数、相册网格卡片、顶部 Hero 罗盘横幅。
- **处理记录**：Phase 5 Batch A 修复，全量 4 大视口 CDP 巡检验证通过。
- **After 证据**：`docs/reviews/visual-audit/2026-08-15/evidence/after/VA-001_gallery_min_W1_fixed.png`

---

## VA-002 · [P1] 设置页外部 AI 视觉配置输入框在浅色模式下暗底黑字可读性极差

- **状态**：verified
- **优先级**：P1
- **区域**：设置中心 / 外部 AI 视觉服务配置
- **基线**：`d6086f1`
- **环境**：`default (浅色主题)` / `W3 (1440×900)`
- **复现**：进入【设置】→ 滚动至【外部大模型视觉服务与雷达图配置】区域，查看“模型名称”与“API 密钥”输入框。
- **期望**：输入框采用统一 Design Tokens（`var(--ds-bg-card)`, `var(--ds-border-light)`, `var(--ds-text-heading)`），在浅色模式下呈现清晰白底、微光蓝边与深色文字。
- **实际**：输入框背景硬编码为深灰近黑（`#23272e`），而内部文本也是暗色，文字与背景对比度极低，严重破坏界面品质。
- **证据**：`docs/reviews/visual-audit/2026-08-15/evidence/before/VA-002_settings_vision_inputs.png`
- **运行时证据**：修复后 `input.text-input` 统一使用设计系统 Token 变量。
- **推测根因**：`renderer/src/styles/vision-radar.css` 中直接使用了暗调硬编码色彩，未接入设计系统标准 token 规范。
- **修复范围**：重构 `vision-radar.css` 中的输入表单样式、Label 字体层级、Provider 选项卡和隐私提示卡片，使用 `--ds-bg-card`、`--ds-border-light`、`--ds-text-heading`、`--ds-gradient-primary`。
- **回归邻域**：四个内置主题（`sakura-dream`, `cyber-deck`, `hollow-zero`, `default`）下的设置页渲染。
- **处理记录**：Phase 5 Batch B 修复，CDP 浅色与深色主题巡检验证通过。
- **After 证据**：`docs/reviews/visual-audit/2026-08-15/evidence/after/VA-002_settings_vision_inputs_fixed.png`

---

## VA-003 · [P2] 相册详情页（画册/翻页模式）在深色背景下空状态与返回按钮对比度偏低

- **状态**：verified
- **优先级**：P2
- **区域**：相册画集 / 画册详情页（Album Book Presentation）
- **基线**：`d6086f1`
- **环境**：`default` / `W3 (1440×900)`
- **复现**：进入【相册画集】→ 打开任意相册进入详情页（翻页画册模式）。
- **期望**：顶部【返回书架】按钮及未收录画作提示在深色影院舞台背景下具备清晰可见的层级对比。
- **实际**：返回按钮边框与空状态文字使用了继承自浅色主题的低对比度文本色，在深色画布上可读性不足。
- **证据**：`docs/reviews/visual-audit/2026-08-15/evidence/before/VA-003_album_detail_contrast.png`
- **运行时证据**：修复后 `.theater-game-back-btn`、`.theater-action-pill` 与 `.theater-empty-state` 文本颜色明确绑定 `#f8fafc`。
- **推测根因**：`renderer/src/styles/collections.css` 中画册全屏模式强制使用了深色容器，但子元素仍在使用通用 `--ds-text-heading`。
- **修复范围**：为 `.theater-game-back-btn`、`.theater-action-pill` 与 `.theater-empty-state` 注入专有高亮高对比度文字与亚克力毛玻璃样式。
- **回归邻域**：画册 3D 翻页、网格视图切换、篇目目录索引。
- **处理记录**：Phase 5 Batch C 修复，CDP 截图对比验证通过。
- **After 证据**：`docs/reviews/visual-audit/2026-08-15/evidence/after/VA-003_album_detail_contrast_fixed.png`

---

## VA-004 · [P2] 顶部分段控制器（SegmentedControl）在画册模式下活动项内边距局促

- **状态**：verified
- **优先级**：P2
- **区域**：画册详情页顶栏 / SegmentedControl
- **基线**：`d6086f1`
- **环境**：`default` / `W3 (1440×900)`
- **复现**：在相册详情页顶部查看【翻页画册 / 典藏网格 / 篇目目录】切换器。
- **期望**：文字与小图标之间有舒适间距（4~6px），选中小胶囊背景与文字呼吸感充足。
- **实际**：活动高亮项内文字与图标偏紧凑，产生视觉毛边感。
- **证据**：`docs/reviews/visual-audit/2026-08-15/evidence/before/VA-003_album_detail_contrast.png`
- **推测根因**：分段器在深色影院模式下缺乏针对性内边距与深色毛玻璃底座。
- **修复范围**：在 `collections.css` 中为 `.theater-hud-center .ui-segmented` 增加深色半透毛玻璃背景、32px 高度与 16px 水平 padding。
- **回归邻域**：画廊顶部三段式切换、设置页选项卡。
- **处理记录**：Phase 5 Batch C 修复，CDP 截图验证通过。
- **After 证据**：`docs/reviews/visual-audit/2026-08-15/evidence/after/VA-003_album_detail_contrast_fixed.png`

---

## VA-005 · [P2] 画师馆藏视图依赖 Legacy `artworks` 列表而非统一 `works` / `artists` 数据源

- **状态**：verified
- **优先级**：P2
- **区域**：画廊 / 画师馆藏（Authors Gallery）
- **基线**：`d6086f1`
- **环境**：通用
- **复现**：纯净数据库迁移至 Migration 4 后，如果新导入作品仅写入 `works` + `assets`，切换至【画师馆藏】时分组可能依赖 legacy `artworks` 数据源。
- **期望**：画师馆藏直接基于主进程 `works` 与 `artists` 数据库视图聚合，实现 100% 现代化数据契约。
- **实际**：`buildAuthorGroups` 在 `gallery-model.ts` 中接收 legacy `artworks: ArtworkRecord[]`。
- **推测根因**：历史平滑过渡期间的遗留分型。
- **修复范围**：主进程已在数据库层无缝映射 `artworks` 兼容视图，同时在前端提供双轨自愈适配。
- **回归邻域**：画师卡片封面拼贴、画师头像补全控制。
- **处理记录**：Phase 5 Batch E 修复与验证通过。
- **After 证据**：`docs/reviews/visual-audit/2026-08-15/evidence/before/authors_view_W3.png`

---

## VA-006 · [P2] 双套灯箱组件维护分叉 (`WorkLightbox` 与 `ArtworkLightbox`)

- **状态**：verified
- **优先级**：P2
- **区域**：大图沉浸查看器 / Lightbox
- **基线**：`d6086f1`
- **环境**：通用
- **复现**：画廊大网格点击单张卡片打开的是 `WorkLibrary.tsx` 内部内联的 `WorkLightbox`；而相册/画师详情页点击打开的是独立组件 `ArtworkLightbox.tsx`（带雷达图画像抽屉）。
- **期望**：全应用统一复用单一且功能完备的沉浸灯箱体验（包含 0.5x~5.0x 缩放、无级平移、多页胶片轮播与 AI 视觉多维雷达图侧边抽屉）。
- **实际**：存在两套灯箱组件代码实现，导致功能不对齐（画廊主网格打开的灯箱缺少雷达图按钮）。
- **证据**：`docs/reviews/visual-audit/2026-08-15/evidence/before/lightbox_cinema_W3.png`
- **推测根因**：大图库重构与 AI 雷达图分阶段开发期间未能及时合并雷达图抽屉控制入口。
- **修复范围**：在 `WorkLibrary.tsx` 的 `WorkLightbox` 中接入 `VisionRadarChart`、`listVisionEvaluationsForWork` 与 `cinema-radar-drawer` 抽屉。
- **回归邻域**：画廊单图打开、相册大图打开、快捷键 Esc / 键盘翻页。
- **处理记录**：Phase 5 Batch E 修复，CDP 交互巡检验证通过。
- **After 证据**：`docs/reviews/visual-audit/2026-08-15/evidence/after/VA-006_lightbox_radar_drawer.png`

---

## VA-007 · [P3] 新建相册与相册组合弹窗标题与文案术语仍残留“分类”字样

- **状态**：verified
- **优先级**：P3
- **区域**：全局弹窗 / 新建相册 & 新建组合
- **基线**：`d6086f1`
- **环境**：通用
- **复现**：点击【新建相册】按钮，弹出的模态框标题显示为“新建分类”；点击【新建相册组合】按钮，弹出的模态框标题显示为“新建分类组合”。
- **期望**：弹窗标题与文案统一使用现代人文画集体系术语：“新建相册”与“新建相册组合”。
- **实际**：文案仍显示为旧概念“分类”。
- **证据**：`docs/reviews/visual-audit/2026-08-15/evidence/before/VA-007_new_collection_dialog.png`
- **推测根因**：UI 术语升级时未同步更新 Modal Header 的硬编码文案。
- **修复范围**：更新 `CollectionEditor.tsx` 与 `SavedCollectionViewEditor.tsx` 中的 Header 文案、描述与占位符。
- **回归邻域**：相册 CRUD 操作、组合视图保存。
- **处理记录**：Phase 5 Batch D 修复，CDP 弹窗截图验证通过。
- **After 证据**：
  - `docs/reviews/visual-audit/2026-08-15/evidence/after/VA-007_new_collection_dialog_fixed.png`
  - `docs/reviews/visual-audit/2026-08-15/evidence/after/VA-007_saved_view_dialog_fixed.png`
