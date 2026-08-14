# 纯净领域 CSS 与设计系统专项审计报告（Style System Findings）

- 审计日期：2026-08-15
- 审计基线：`d6086f1`

---

## 1. 设计系统十项专项审查结论

### 1. 哪些颜色、圆角、阴影、间距、字体尺寸没有使用 token？
- **发现**：`vision-radar.css` 中的 `input.vision-config-input` 与 `button.btn-test-connection` 使用了硬编码的 `#23272e`, `#abb2bf`, `rgba(255,255,255,0.08)`，导致在浅色主题下无法自适应背景和边框；
- **规范要求**：全面迁移为 `--ds-bg-input`、`--ds-border-light`、`--ds-text-primary`、`--ds-radius-md`。

### 2. 哪些同类按钮/卡片/弹窗存在重复实现？
- **发现**：
  1. `collection-filter-button`、`collection-edit-button` 与 `saved-view-btn-action` 均为画作/相册卡片上的悬浮毛玻璃操作按钮，但在 CSS 中分别定义了微小的尺寸和圆角差异；
  2. 新建相册弹窗 (`CollectionModal`) 与相册组合编辑器 (`SavedCollectionViewEditor`) 的遮罩层与底部按钮条样式高度类似但类名分散。

### 3. 是否仍有 legacy 样式影响新组件？
- **发现**：`collections.css` 中早期定义的 `.collection-card` 部分样式与全新的 `.album-card-book` 精装书脊样式存在层叠覆盖，部分未被清除的流式操作条残留规则易导致定位混乱。

### 4. 同一状态是否用多个 class/命名体系表达？
- **发现**：加载状态在不同模块中混用了 `.busy`、`.loading`、`.is-loading` 以及自定义的 `.work-opening`。应在 `components.css` 中统一状态类名。

### 5. 主题是否只改颜色，还是错误地改变布局和可用性？
- **发现**：内置的 4 套主题（`default`, `sakura-dream`, `cyber-deck`, `hollow-zero`）均通过 CSS 变量纯净注入，没有改动 DOM 结构或破坏网格弹性布局，主题隔离机制良好。

### 6. z-index 是否形成可解释层级？
- **层级基线**：
  - 内容层：`z-index: 1`
  - 卡片内相对浮层（书脊、角标、操作胶囊）：`z-index: 2 ~ 5`
  - 侧边栏/固定顶栏：`z-index: 10 ~ 20`
  - 批量操作浮动底栏：`z-index: 30`
  - 全局 Dialog 模态层：`z-index: 100`
  - 全景 Cinema Lightbox 大图：`z-index: 1000`
  - Toast / AppNotice 通知：`z-index: 2000`
- **发现**：层级整体清晰，无 `z-index: 99999` 混乱竞争。

### 7. 哪些固定高度/宽度在 W1/W2 产生问题？
- **发现**：`body` 的 `min-width: 960px` 造成了 900px 最小窗口宽度（W1）下的 60px 横向滚动溢出（参见 `VA-001`）。

### 8. 哪些动画在 efficient 或 reduced-motion 下仍运行？
- **发现**：罗盘惯性阻尼与卡片 hover 抬升在 `reduced-motion` 规则下均有合理的 `transition: none` 覆盖，符合系统规范。

### 9. 图片容器是否统一处理 `object-fit`、加载占位和错误状态？
- **发现**：画廊 `LazyWorkImage`、相册 `album-book-cover img` 以及大图查看器 `cinema-image-entity` 均统一配置了 `object-fit: cover` / `contain` 与骨架占位。

### 10. 是否存在两套灯箱、两套通知、两套按钮等维护分叉？
- **发现**：存在两套灯箱实现——`WorkLibrary.tsx` 内联的 `WorkLightbox`（无 AI 雷达抽屉）与独立组件 `ArtworkLightbox.tsx`（功能全量）。应在后续重构中合并为单一灯箱入口。

---

## 2. 推荐的分批修复边界（Phase 5 规划）

| 批次编号 | 目标范围 | 涵盖 VA 编号 | 风险级别 | 预期效果 |
|---|---|---|---|---|
| **Batch A: 视口基线与响应式弹性** | 壳层与通用布局 | `VA-001` | 低 | 彻底解决 900×620 最小窗口下的横向滚动溢出，对齐 Electron 窗口基线。 |
| **Batch B: 表单与设置中心 Tokens 化** | 设置页与外部 AI 视觉配置 | `VA-002` | 低 | 修复浅色模式下暗底黑字可读性缺陷，统一使用设计系统 Token 变量。 |
| **Batch C: 画册详情与暗色舞台对比度** | 相册详情、SegmentedControl | `VA-003`, `VA-004` | 低 | 提升深色画册舞台下的空状态文本、返回药丸与选项卡内边距呼吸感。 |
| **Batch D: 弹窗与画集术语收口** | 全局 Dialog 标题与文案 | `VA-007` | 极低 | 统一全局文案为“相册”与“相册组合”，消除“分类”残留。 |
| **Batch E: 数据源统一与灯箱收敛** | 馆藏数据聚合、统一 ArtworkLightbox | `VA-005`, `VA-006` | 中 | 收敛两套灯箱维护分叉，画廊大网格大图直接支持雷达抽屉。 |
