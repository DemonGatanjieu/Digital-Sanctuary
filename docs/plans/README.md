# 计划文档索引

这里区分“现在要做什么”和“当初为什么这样选”，避免早期草稿重新变成待办。

## 唯一现行计划

- [`ACTIVE_ROADMAP.md`](./ACTIVE_ROADMAP.md)：当前施工任务、排队提案、阶段门槛和完成基线的唯一索引。

## 当前任务与提案

- [`TASK_LOCAL_AI_PLAYGROUND_AND_WIDGET_WORKSHOP.md`](./TASK_LOCAL_AI_PLAYGROUND_AND_WIDGET_WORKSHOP.md)：后续方向；本地灵感台之后的自由工作台与安全小组件，尚未整包授权施工。
- [`TASK_SEMANTIC_SEARCH_CLIP_AND_EXTERNAL_VISION.md`](./TASK_SEMANTIC_SEARCH_CLIP_AND_EXTERNAL_VISION.md)：排队中的语义搜索架构提案，尚未授权施工。

## 历史归档

- [`archive/2026-08-11-implementation-plan-draft.md`](./archive/2026-08-11-implementation-plan-draft.md)：启动期技术选型及首个完整闭环的阶段草稿。
- [`archive/2026-08-10-implementation-options.md`](./archive/2026-08-10-implementation-options.md)：路线 A/B/C 的早期比较。
- [`archive/2026-08-10-project-structure-plan.md`](./archive/2026-08-10-project-structure-plan.md)：建仓前的目标目录设想。
- [`archive/2026-08-14-productization-roadmap-p0-p11-complete.md`](./archive/2026-08-14-productization-roadmap-p0-p11-complete.md)：已经完成的 2.0 产品化重构路线。
- [`archive/2026-08-14-theme-system-backend.md`](./archive/2026-08-14-theme-system-backend.md)：已经完成的主题后端任务。
- [`archive/2026-08-14-task-ai-radar-and-external-vision-implementation-plan.md`](./archive/2026-08-14-task-ai-radar-and-external-vision-implementation-plan.md)：已经完成的 AI 雷达与外部视觉实施规划。
- [`archive/2026-08-15-full-product-visual-audit.md`](./archive/2026-08-15-full-product-visual-audit.md)：已经完成的全产品视觉审计任务书；验收证据仍在 `docs/reviews/visual-audit/2026-08-15/`。
- [`archive/2026-08-15-typography-system-and-custom-fonts-complete.md`](./archive/2026-08-15-typography-system-and-custom-fonts-complete.md)：已经完成的排版系统执行版；验收报告在 `docs/reviews/typography/`。
- [`archive/2026-08-15-typography-system-implementation-plan.md`](./archive/2026-08-15-typography-system-implementation-plan.md)：排版需求来源草案，冲突时以执行版为准。
- [`archive/2026-08-15-photobook-3d-page-flip-and-photo-mount-complete.md`](./archive/2026-08-15-photobook-3d-page-flip-and-photo-mount-complete.md)：已经完成的画册 3D 翻页与装裱任务。
- [`archive/2026-08-15-photobook-double-spread-and-floating-toc-complete.md`](./archive/2026-08-15-photobook-double-spread-and-floating-toc-complete.md)：已经完成的双页对开与浮动目录任务。
- [`archive/2026-08-15-photobook-flicker-free-3d-engine-redesign.md`](./archive/2026-08-15-photobook-flicker-free-3d-engine-redesign.md)：已经完成的零闪烁翻页引擎重构方案。
- [`archive/2026-08-15-photobook-flicker-technical-analysis.md`](./archive/2026-08-15-photobook-flicker-technical-analysis.md)：画册闪烁根因分析白皮书，只用于追溯。
- [`archive/2026-08-24-personal-tag-preference-and-prompt-bridge-complete.md`](./archive/2026-08-24-personal-tag-preference-and-prompt-bridge-complete.md)：已完成的探索双向偏好、标签调音台、ComfyUI 本地桥接与区域遮罩独立评审。
- [`archive/2026-08-24-element-inspector-frontend-polish-complete.md`](./archive/2026-08-24-element-inspector-frontend-polish-complete.md)：已经完成的元素透视前端精修；验收证据在 `docs/reviews/element-inspector-polish/2026-08-24/`。

归档文档只用于追溯，不代表仍待实现；其中与当前代码冲突的内容以根目录 [`ARCHITECTURE.md`](../../ARCHITECTURE.md)、[`Project_Vision.md`](../../Project_Vision.md) 和现行路线为准。

## 相邻文档的职责

- `docs/research/`：技术实验、基准和方案证据，不是承诺实施的排期。
- `docs/design/`：已经采用的产品、交互、数据与工程设计，是现行路线的设计输入。
- `docs/known-issues/`：已复现问题、临时处理和重新启用门槛。
- `docs/handoff/`：当前状态与验收清单，帮助下一位开发者接手。
- `docs/adr/`：已经接受的不可随意改变的架构决策。

## 维护规则

1. 同一时间只保留一份 `ACTIVE_ROADMAP.md`。
2. 已完成阶段移入带日期的归档并保留验收证据，不继续堆在根目录。
3. 研究提案只有被明确采纳后才能进入现行路线。
4. 计划变化必须同时检查 `README.md`、`ARCHITECTURE.md`、交接文档和已知问题索引。
