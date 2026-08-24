# 计划文档索引

这里区分“现在要做什么”和“当初为什么这样选”，避免早期草稿重新变成待办。

## 唯一现行计划

- [`ACTIVE_ROADMAP.md`](./ACTIVE_ROADMAP.md)：当前施工任务、排队提案、阶段门槛和完成基线的唯一索引。

## 当前任务与提案

- [`TASK_ELEMENT_INSPECTOR_FRONTEND_POLISH_FOR_GEMINI.md`](./TASK_ELEMENT_INSPECTOR_FRONTEND_POLISH_FOR_GEMINI.md)：已授权给 Gemini 的元素透视前端精修任务；后端边界、百分比语义与验收留痕要求已锁定。
- [`TASK_TYPOGRAPHY_SYSTEM_AND_CUSTOM_FONTS_FOR_GEMINI.md`](./TASK_TYPOGRAPHY_SYSTEM_AND_CUSTOM_FONTS_FOR_GEMINI.md)：经过架构评审、可由 Gemini 分阶段执行的排版系统任务。
- [`TASK_TYPOGRAPHY_SYSTEM_AND_CUSTOM_FONTS_IMPLEMENTATION_PLAN.md`](./TASK_TYPOGRAPHY_SYSTEM_AND_CUSTOM_FONTS_IMPLEMENTATION_PLAN.md)：排版需求来源草案；冲突时以上述执行版为准。
- [`TASK_SEMANTIC_SEARCH_CLIP_AND_EXTERNAL_VISION.md`](./TASK_SEMANTIC_SEARCH_CLIP_AND_EXTERNAL_VISION.md)：排队中的语义搜索架构提案，尚未授权施工。

## 历史归档

- [`archive/2026-08-11-implementation-plan-draft.md`](./archive/2026-08-11-implementation-plan-draft.md)：启动期技术选型及首个完整闭环的阶段草稿。
- [`archive/2026-08-10-implementation-options.md`](./archive/2026-08-10-implementation-options.md)：路线 A/B/C 的早期比较。
- [`archive/2026-08-10-project-structure-plan.md`](./archive/2026-08-10-project-structure-plan.md)：建仓前的目标目录设想。
- [`archive/2026-08-14-productization-roadmap-p0-p11-complete.md`](./archive/2026-08-14-productization-roadmap-p0-p11-complete.md)：已经完成的 2.0 产品化重构路线。
- [`archive/2026-08-14-theme-system-backend.md`](./archive/2026-08-14-theme-system-backend.md)：已经完成的主题后端任务。
- [`archive/2026-08-14-task-ai-radar-and-external-vision-implementation-plan.md`](./archive/2026-08-14-task-ai-radar-and-external-vision-implementation-plan.md)：已经完成的 AI 雷达与外部视觉实施规划。
- [`archive/2026-08-15-full-product-visual-audit.md`](./archive/2026-08-15-full-product-visual-audit.md)：已经完成的全产品视觉审计任务书；验收证据仍在 `docs/reviews/visual-audit/2026-08-15/`。
- [`archive/2026-08-24-personal-tag-preference-and-prompt-bridge-complete.md`](./archive/2026-08-24-personal-tag-preference-and-prompt-bridge-complete.md)：已完成的探索双向偏好、标签调音台、ComfyUI 本地桥接与区域遮罩独立评审。

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
