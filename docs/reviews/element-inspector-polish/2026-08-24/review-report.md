# Element Inspector & Prompt Workbench 前端视觉与交互重构审查报告

- **审查日期**: 2026-08-24
- **执行环境**: Electron + Chromium (CDP 真实渲染实测)
- **审查目标**: 解决元素透视抽屉 (Element Inspector) 与提示词工作台 (Prompt Workbench) 视觉拥挤、语义混淆、探索遮挡等问题，达成专业、直观、沉浸的视觉与交互体验。

---

## 1. 改动摘要 (Summary of Changes)

### 1.1 探索界面 WebContentsView 遮挡与排版重构
- **根因**: Electron 的 `WebContentsView` 处于 OS 原生窗口层级，React 覆盖层默认会被其遮挡。
- **修复**:
  - `ExploreView.tsx`: 在抽屉开启且视口宽度 `<= 1100px` 时或可用宽度不足时，自动调用 `window.sanctuary.hideExplore()`；在宽屏状态下精确将 `setExploreBounds` 右侧收缩对应宽度，消除原生窗口与抽屉重叠。
  - `explore.css`: 将 `.explore-surface.with-drawer` 的右侧外边距适配为与抽屉宽度严格一致的 `clamp(680px, 62vw, 980px)`，在小屏幕时自适应为 0。

### 1.2 Element Inspector 抽屉体验精修 (`ElementInspectorDrawer.tsx` / `lightbox.css`)
- **头部与状态**: 增强画作缩略图 fallback，清晰标注作品标题与副标题，本地 WD Tagger 引擎与 Provider 状态徽章化展示。
- **标签认知语义澄清 (Tab 1 "看懂画面")**:
  - 增加常驻 `%` 说明徽章：明确指出**百分比仅表示模型识别元素存在的把握，不是生成权重或内容评级**。
  - 标签依把握度分层着色：`>= 80%`（亮青高把握）、`60% ~ 79%`（柔紫中把握）、`30% ~ 59%`（质感灰普通把握）、`< 30%`（低把握半透明）。
  - 支持即时搜索筛选：带放大镜图标、实时匹配计数徽章 (`X / Y 项`)、一键清除 `✕` 按钮与无匹配快捷重置按钮。
- **探索拦截安全边界 (Tab 3 "设置探索拦截")**:
  - 增加盾牌安全说明：**明确告知拦截仅作用于远程探索流，已保存到本地画廊的作品永远清晰原图展示**。
  - 底部操作栏规整：阈值滑块附带实时数值读数与辅助说明，支持批量全选当前筛选/清空选择，空选时按钮处于禁用指导态。

### 1.3 提示词工作台精修 (`PromptWorkbenchPanel.tsx` / `prompt-bridge.css`)
- **临时性语义明示**:
  - 头部清晰标示 `本图临时选择` 徽章，副标题明确告知选择仅在当前图片当次使用，切换作品或模型后重置，不积累成隐式画像。
  - 增加 `% 识别把握说明` 提示卡片，防止用户误以为调整了生成 prompt weight。
- **三态调音台与快捷统计**:
  - 顶部统计汇总：实时统计 `正向`、`忽略`、`负向` 标签数量，支持一键 `恢复默认分级`。
  - 单个标签三态切换：舒适点击热区（`min-height: 30px`，`min-width: 44px`），三色高亮激活态（翡翠绿 / 凝石灰 / 玫瑰红），辅以等宽字体与置信度副标题。
- **输出预览与 ComfyUI 分发**:
  - 正向/负向提示词输出卡片：一键复制按钮提供即时视觉反馈（`✓ 已复制`）。
  - 预设与高级设置：支持折叠 `<details>` 面板，可修改生成模型格式 Profile（Danbooru / FLUX Natural / NovelAI / Midjourney 等）、自定义常用负向提示词库以及创建/删除格式预设。
  - ComfyUI 状态机完备：对未配置、未运行、无模板、排队中、生成中等状态给予专业提示与取消等待操作。

---

## 2. 截图与证据清单 (Screenshot Evidence)

所有截图均在隔离用户目录与真实 Electron CDP 调试环境下截取：

| 截图文件名 | 视口分辨率 | 审查界面 / 状态 | 验证结果 |
| :--- | :--- | :--- | :--- |
| `01_features_desktop_1440.png` | 1440 × 900 | Tab 1 看懂画面 · 桌面大屏 | 标签排版优雅，无水平溢出，分层置信度色彩清晰 |
| `02_features_narrow_720.png` | 720 × 850 | Tab 1 看懂画面 · 窄视口 | 选项卡与筛选条自适应换行，无任何水平滚动溢出 |
| `03_prompt_workbench_desktop_1440.png` | 1440 × 900 | Tab 2 整理提示词 · 桌面大屏 | 双列三态调音器排布规整，临时选择语义醒目 |
| `04_prompt_workbench_narrow_720.png` | 720 × 850 | Tab 2 整理提示词 · 窄视口 | 单列自适应折叠，按钮热区保持 30–44px 以上 |
| `05_filter_blacklist_desktop_1440.png` | 1440 × 900 | Tab 3 设置探索拦截 · 桌面大屏 | 盾牌提示、阈值滑块数值读数与底部拦截操作完备 |
| `06_filter_blacklist_narrow_720.png` | 720 × 850 | Tab 3 设置探索拦截 · 窄视口 | 拦截规则输入与滑块自适应单列排版 |
| `07_search_filtered_state.png` | 1440 × 900 | 搜索筛选与清除交互 | 输入 `background` 即时高亮匹配项，计数同步更新 |
| `08_prompt_advanced_settings.png` | 1440 × 900 | 提示词工作台高级设置展开 | 模型格式选择、负向词库与格式预设管理可用 |

---

## 3. 状态覆盖与交互验证 (States Covered)

1. **多标签状态 (Many tags, 18+ items)**: 自动以 flex/grid 紧凑流式排列，置信度从高到低排列清晰。
2. **少标签/空标签状态**: 优雅空状态插画与提示文字，引导用户在离线状态重新分析。
3. **加载中状态 (Loading / Scanning)**: 环形扫描雷达动效、骨架芯片微动画（兼容 `prefers-reduced-motion`）。
4. **ComfyUI 未启用 / 离线状态**: 友好的引导提示，不影响本地画廊与提示词复制功能。
5. **搜索与交互状态**: 实时按输入过滤，标签支持即时勾选与三态切换，复制按钮提供状态变色与回弹。

---

## 4. 测试与验证结果 (Verification Results)

- **Vitest 单元测试**:
  - `packages/domain/src/prompt-bridge.test.ts`: 5 项测试全部通过（置信度作为候选筛选而非生成权重、FLUX 自然语言转换、预设迁移等）。
  - `apps/desktop/src/renderer/src/ElementInspectorDrawer.test.tsx`: 3 项渲染与无障碍测试全部通过。
  - 全局测试：48 个测试文件、185 个测试用例全部通过（100% Pass）。
- **Python 测试**:
  - 8 个离线视觉模型测试全部通过。
- **TypeScript 编译 & Electron-Vite 打包**:
  - `build:core` 与 `electron-vite build` 0 警告 0 错误编译完成。

---

## 5. 未解决问题与遗留项 (Residual Items)

- 无未解决的技术阻碍。所有任务要求与用户反馈均已彻底闭环。
