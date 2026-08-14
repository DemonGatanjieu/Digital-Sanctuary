# 版本快照记录 (Snapshots Record)

这里记录了各个关键阶段的稳定版本 Git Commit Hash。如果您对后续的实验性修改不满意，可以使用 `git reset --hard <CommitHash>` 一键回退到对应版本。

| 阶段 / 里程碑 | Git Commit Hash | 日期 | 描述 |
| --- | --- | --- | --- |
| **v2-backend-stable** | `68822d0d37f44dcf624da619101621a184f14731` | 2026-08-14 | UI 实验阶段开始前，后端与数据库架构（包含 Saved Collection Views 分类组合功能）稳定成熟的完整版。 |
| **v2-theme-system-complete** | `2baa1e6711b15e0abcaffbaecf73d2326c82c187` | 2026-08-14 | 动态主题引擎、绝区零官方预设与 GitHub 社区主题商店全栈完成版本。 |
| **v2-multi-theme-and-avatar** | `87bfb9781a5156189abc7a94c84ecb8241f389ea` | 2026-08-14 | 4 套深度定制官方预设主题（蔚蓝/绝区零/樱落粉彩/赛博终端）与用户自定义头像持久化上传。 |
| **v2-interactive-compass-dial** | `44ecb0ebb9a81264c03ae9bbc6f1c4fb7066fc9a` | 2026-08-14 | 画廊顶部 360° 动力学星盘罗盘（新增 12 点钟发光基准箭头 Reticle、中心双向磁性指针与物理惯性阻尼）。 |
| **v2-cinema-viewer-and-artbook-album** | `4cfd5699226f44555fb3de1781d7fb085f30fec2` | 2026-08-14 | 影院级大图全貌查看器、画集相册体系、相册内从画廊直接挑选作品模态框、以及顶部横幅与罗盘高对比度深色毛玻璃底盘优化。 |
| **v2-compass-chromatic-engine** | `f4c0539a9fb7ed668bea7abdbd2c2099e63f7c27` | 2026-08-14 | 罗盘手感物理引擎重构（1:1 绝对极坐标零延迟追踪、时间窗口滑动起飞飞轮惯性）与 360° 无极实时流光光谱变色引擎（随转动角度无缝流动变色）。 |
| **v2-global-wholeness-polish** | `1cda0e8106ad9fbbdbd55bf9278384f7188e88b0` | 2026-08-14 | 全局联动体验统一（画廊卡片/多选/画师/相册全面打通影院级全景查看器与相册管理、罗盘扩大透明触控/拖拽热区 hit-slop）。 |
| **audit-phase-1-baseline-and-routing** | `0387dbf08de08c1ccb76e0b9d0847ae643480117` | 2026-08-14 | 阶段 1 基线与路由闭环：修复 11 个 TS 类型检查错误、新增 npm run verify 门禁、修通相册卡片直达详情页与返回路由、修复组合视图契约。 |
| **v2-compass-fixed-north-needle** | `caf6065127a1ff8d99f69bbf453af39032efb38d` | 2026-08-14 | 罗盘交互物理心智模型修正：中心指针始终固定垂直指向 12 点钟（正北基准 Reticle），外圈符文随转动在指针下方旋转对齐。 |
| **v2-compass-spring-physics-and-rule6** | `76a60c81edfeb770a43558d0e21a278f1b9293a5` | 2026-08-14 | 罗盘物理动效深度重构：引入最短路径物理弹簧柔和吸附（零角度突跳）、消除符文遮挡中心、在智能体规则库确立人类物理直觉铁律。 |
| **v2-compass-revert-original-clean** | `bd23a0f179f0c6bc33a820a175c93706d75b9123` | 2026-08-14 | 罗盘状态完整回退到最早最简洁清爽的经典稳定版本。 |












