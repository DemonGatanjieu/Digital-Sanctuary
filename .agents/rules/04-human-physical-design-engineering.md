# 04. Human Physical Intuition & Design Engineering (人类体感与设计工程学)

> 🔒 Dedicated Rule for Antigravity / Gemini Workspace Assistant in Digital Sanctuary (纯净领域).

---

## 1. 外框物理定锚法则 (Rock-Solid Frame Immutability)
- 画框外层容器必须绝对物理静止（严禁外层声明隐式 `transition: transform` 或边界尺寸缩放）。
- 所有滑轨和翻页叶片动画仅在固定视口内部流畅穿梭，杜绝外边框和外阴影抖动。

---

## 2. 自然动量与生物视觉阻尼 (Natural Fluid Momentum)
- 杜绝瞬间暴冲后急停的陡峭曲线，全面采用符合人体生理视觉惯性的流体曲线（如 `0.36s cubic-bezier(0.25, 1, 0.5, 1)`）。
- 拖拽与滑行释放时采用二阶弹簧阻尼衰减，落位顺滑柔和。

---

## 3. GPU 硬件合成层隔离 (Compositor Layer Promotion)
- 动画元素一律标记 `contain: layout paint` 与 `will-change: transform, opacity`。
- 动效完全由 Chromium GPU Compositor 独立线程处理，主线程 0 阻塞，稳定 60/120fps 满帧。

---

## 4. 全幅双轨无缝包裹 (Dual-Spread Continuous Enclosure)
- 平移动画必须采用 200% 宽度双展对连续轨道，旧展对与新展对作为一个整体横向无缝推拉，底台全程冻结，严禁任何 1 毫秒提前暴露新图。

---

## 5. 旋转与方向连续性 (Rotational Continuity)
- 顺时针/逆时针拖动时角度必须连续微积分映射，严禁 $0^\circ \leftrightarrow 360^\circ$ 边界突变导致“反向甩动”或跳跃。
