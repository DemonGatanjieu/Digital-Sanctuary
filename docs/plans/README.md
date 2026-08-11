# 计划文档索引

这里区分“现在要做什么”和“当初为什么这样选”，避免早期草稿重新变成待办。

## 唯一现行计划

- [`ACTIVE_ROADMAP.md`](./ACTIVE_ROADMAP.md)：当前优先级、止损条件、验收标准和推荐提交顺序。新增实施任务只写入这里。

## 历史归档

- [`archive/2026-08-11-implementation-plan-draft.md`](./archive/2026-08-11-implementation-plan-draft.md)：启动期技术选型及首个完整闭环的阶段草稿。
- [`archive/2026-08-10-implementation-options.md`](./archive/2026-08-10-implementation-options.md)：路线 A/B/C 的早期比较。
- [`archive/2026-08-10-project-structure-plan.md`](./archive/2026-08-10-project-structure-plan.md)：建仓前的目标目录设想。

归档文档只用于追溯，不代表仍待实现；其中与当前代码冲突的内容以根目录 [`ARCHITECTURE.md`](../../ARCHITECTURE.md)、[`Project_Vision.md`](../../Project_Vision.md) 和现行路线为准。

## 相邻文档的职责

- `docs/research/`：技术实验、基准和方案证据，不是承诺实施的排期。
- `docs/known-issues/`：已复现问题、临时处理和重新启用门槛。
- `docs/handoff/`：当前状态与验收清单，帮助下一位开发者接手。
- `docs/adr/`：已经接受的不可随意改变的架构决策。

## 维护规则

1. 同一时间只保留一份 `ACTIVE_ROADMAP.md`。
2. 已完成阶段从现行计划移入 Git 历史或带日期的归档，不继续堆在根目录。
3. 研究提案只有被明确采纳后才能进入现行路线。
4. 计划变化必须同时检查 `README.md`、`ARCHITECTURE.md`、交接文档和已知问题索引。
