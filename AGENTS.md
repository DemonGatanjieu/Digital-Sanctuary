# Digital Sanctuary (纯净领域) - Workspace Rules & Design Engineering Principles

These rules apply to all development and UI/UX design experiments in this workspace.

---

## 1. Mandatory Git Snapshots & Architecture Sync
- **Always take a Git Snapshot**: Before performing any modifying actions or starting a new UI/feature task, ALWAYS run `git add .` and `git commit -m "..."` to snapshot the workspace state. This ensures easy rollback if an experiment fails.
- **Always read and sync ARCHITECTURE.md**: Read `e:\PIxiv\ARCHITECTURE.md` to understand the current architecture baseline. After completing any modifications to the codebase (especially UI/UX or architectural changes), synchronize and update `ARCHITECTURE.md` and `docs/snapshots_record.md`.
- **Run Verification Gate**: Always execute `npm.cmd run verify` (typecheck + vitest + python unittest + electron-vite build) to ensure 0 regression before finishing.

---

## 2. Creative UI & Aesthetic Guidelines
- **Zero Generic Bootstrap/Tailwind Templates**: The user dislikes plain, generic engineer-like UI. Always prioritize distinctive, premium, and highly aesthetic interactive elements.
- **Rich Aesthetics**: Use glassmorphism, subtle curated HSL gradients, micro-animations, stack effects, floating acrylic islands, and context-aware HUDs.
- **Typography & Font Integrity**: Support custom typography protocol (`sanctuary-font://`) and high-legibility display hierarchies without layout shifting.

---

## 3. Global System Wholeness & End-to-End Cohesion (全盘全局操作与端到端协同)
- 严禁只做“单点局部修补”而遗漏全局操作联动（杜绝毛坯体感）。
- 任何涉及核心实体（如相册/分类、画师馆藏、大图全屏查看、多选批量操作、搜索筛选、主题切换）的改动，必须全流程闭环打通：
  - **画廊全景 (Flat Gallery)**：卡片操作、相册下拉、多选胶囊条、加入相册 Toast 与 Undo 撤销。
  - **相册画集 (Albums)**：精装封面、卷首题记、目录索引 (TOC)、网格双模式、相册内直接挑选画作弹窗、4 种翻页动画切换。
  - **画师馆藏 (Author Detail)**：作者作品列表直达、加入相册、打开影院级全屏大图。
  - **影院级全景查看器 (Cinema Lightbox)**：任何入口（画廊、相册、画师、顶部横幅）打开均应完整无裁切展示、支持滚轮缩放/拖拽平移、键盘快捷键与多页胶片轨。
  - **触控与操作热区 (Hit Targets)**：交互组件（如罗盘拨盘、悬浮控制岛、快捷操作胶囊）必须拥有宽裕的触控/拖拽热区，防止脱靶或边缘卡顿。

---

## 4. Human Physical Intuition & Design Engineering (人类体感与设计工程学)
1. **外框物理定锚法则 (Rock-Solid Frame Immutability)**:
   - 画框外层容器必须绝对物理静止（严禁外层声明隐式 `transition: transform` 或边界尺寸缩放），所有滑轨和叶片动画仅在固定视口内部流畅穿梭，杜绝外边框和外阴影抖动。
2. **自然动量与生物视觉阻尼 (Natural Fluid Momentum)**:
   - 杜绝瞬间暴冲后急停的陡峭曲线，全面采用符合物理惯性的流体曲线（如 `0.36s cubic-bezier(0.25, 1, 0.5, 1)`）。
3. **GPU 硬件合成层隔离 (Compositor Layer Promotion)**:
   - 动画元素一律标记 `contain: layout paint` 与 `will-change: transform, opacity`，由 Chromium GPU Compositor 独立线程处理，主线程 0 阻塞，稳定 60/120fps。
4. **全幅双轨无缝包裹 (Dual-Spread Continuous Enclosure)**:
   - 平移动画必须采用 200% 宽度双展对连续轨道，旧展对与新展对作为一个整体横向无缝推拉，底台全程冻结，严禁任何 1 毫秒提前暴露新图。
5. **旋转与方向连续性**:
   - 顺时针/逆时针拖动时角度必须连续微积分映射，严禁 $0^\circ \leftrightarrow 360^\circ$ 边界突变导致“反向甩动”或跳跃。
