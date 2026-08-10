# ADR 0001：首版桌面容器

- 状态：已接受（首版）
- 日期：2026-08-10

## 决策

首版使用 Electron + React + TypeScript。远程探索页后续使用 `WebContentsView`，不使用已弃用的 `BrowserView`；加载远程内容的 renderer 关闭 Node.js 集成并开启上下文隔离和沙箱。

## 原因

项目优先考虑复杂画廊 UI、成熟的 Chromium 会话控制和 Windows 首发效率。是否迁移到更轻的容器，等第一条端到端链路和真实性能数据出现后再决定。

