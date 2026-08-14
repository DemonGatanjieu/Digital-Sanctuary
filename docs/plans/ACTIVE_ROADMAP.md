# 现行实施路线：排版系统与后续检索能力

- 状态：唯一现行路线索引
- 更新日期：2026-08-15
- 已完成产品化路线：`archive/2026-08-14-productization-roadmap-p0-p11-complete.md`

## 当前施工任务

### T1：排版系统与自定义字体

- 执行规划：[`TASK_TYPOGRAPHY_SYSTEM_AND_CUSTOM_FONTS_FOR_GEMINI.md`](./TASK_TYPOGRAPHY_SYSTEM_AND_CUSTOM_FONTS_FOR_GEMINI.md)
- 需求来源：[`TASK_TYPOGRAPHY_SYSTEM_AND_CUSTOM_FONTS_IMPLEMENTATION_PLAN.md`](./TASK_TYPOGRAPHY_SYSTEM_AND_CUSTOM_FONTS_IMPLEMENTATION_PLAN.md)
- 状态：待 Gemini 执行 Phase 0；完成探针、验证和 ADR 后停止等待验收。
- 关键门槛：不暴露字体路径、不自动枚举系统字体、不打包未审核字体、不用全局加粗或 glow 掩盖可读性。

推荐顺序：

1. Phase 0：Electron Local Font Access、协议和解析器探针；
2. Phase 1：语义排版 token 与无行为迁移；
3. Phase 2：字体沙箱、索引和受控协议；
4. Phase 3：偏好与 TypographyProvider；
5. Phase 4：设置页与系统字体退化路径；
6. Phase 5：随包字体候选，必须再次获得用户批准；
7. Phase 6：全产品视觉与打包回归。

## 排队但未授权施工

### T2：本地 CLIP / 向量语义搜索

- 提案：[`TASK_SEMANTIC_SEARCH_CLIP_AND_EXTERNAL_VISION.md`](./TASK_SEMANTIC_SEARCH_CLIP_AND_EXTERNAL_VISION.md)
- 状态：架构提案；尚未形成经过评审的实施规划，不能直接开工。
- 开工前必须补齐：模型许可与体积、embedding 版本和失效策略、向量索引基准、GPU/CPU 资源预算、隐私边界和迁移方案。

## 已完成基线

- 产品化重构 P0～P11：已归档；
- 主题系统与 GitHub 主题商店：已完成并归档；
- AI 技术画像、外部视觉 adapter、雷达 UI：已完成并归档；
- 全产品视觉审计 Phase 1～6：已完成，报告保存在 `docs/reviews/visual-audit/2026-08-15/`；
- 语义搜索仅完成任务拆分和 ADR，不等于功能已经实现。

## 维护规则

1. 同一时间只允许一个任务处于代码施工状态。
2. 来源草案负责表达想法，执行版负责工程边界；冲突时以经过评审的执行版为准。
3. 每阶段必须执行 `npm.cmd run verify`，单独提交并等待验收。
4. 已完成任务移入 `docs/plans/archive/`，不删除 Git 历史和验收证据。
5. 未解决问题进入 `docs/known-issues/` 或带状态的审计账本，不从计划中静默消失。
6. 新能力不得破坏主动下载可信、显式模型分析、Renderer 无任意文件路径和远程 Pixiv 隔离等既有边界。
