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
| **v2-compass-rune-origin-fix** | `c126b92fe8dc0cd70389b4ba0055237482ca185f` | 2026-08-14 | 彻底根治符文飞出圆盘的 CSS transform-origin 叠加问题，四个方位符文完美内嵌在外圈刻度星轨上。 |
| **v2-photobook-3d-dual-spread-flip** | `1c3d3cfe399aebb08b56011be202c386cdc9be44` | 2026-08-14 | 拟真 3D 典藏画集双页对开翻页书台：左页目录篇目与交互缩略索引，右页哑光装裱展台，支持点击翻页/键盘/目录直达与丝带书签。 |
| **v2-in-game-fullscreen-album-theater** | `7ccfdfdb560eb7f6eabe907e830c2f2a00b81a14` | 2026-08-14 | 沉浸式游戏全屏相册剧场：默认点击相册直接展开为类游戏画册全屏 HUD，配有环境弥散光晕底色、游戏快捷键提示与 ESC 一键退出。 |
| **task-ai-radar-and-external-vision** | `4c30fe6d4f607b671502b330960a20b81782cc1b` | 2026-08-14 | 规划并输出 AI 多维视觉雷达图评估系统后端任务书：扩充专业美术、二次元角色魅力（瑟瑟度/萌力/气场）、场景氛围预设集及 AI 自决最高特质高光维度体系。 |
| **vision-phase-0-spec-and-fixtures** | `4e020ac2944e1fdd7e67330bd9370d62cc88b051` | 2026-08-15 | 实施 Phase 0：统一 Vision 领域模型与套件定义（技术画像/美术造诣/角色表现）、实现运行时评分校验器、建立可重复测试图片 Fixture 生成器与 100 项自动化测试基线。 |
| **vision-phase-1-local-profile** | `6857e38a52ee112009a1d2a1da76d689b634db43` | 2026-08-15 | 实施 Phase 1：实现本地确定性技术视觉画像（Pillow/NumPy 6 维统计特征算子）、扩展 Python JSONL 与 TS 协议管道、通过 7 项 Python 专项测试与 101 项全门禁测试。 |
| **vision-phase-2-db-and-jobs** | `92a01c3695567e0c78366d4c9cb3c3d1133ac834` | 2026-08-15 | 实施 Phase 2：SQLite Migration 4 建立评估结果、多维分数值与外部请求审计表；实现精确缓存指纹；打通任务系统与技术画像封面资产分析链路。 |
| **vision-phase-3-secrets-and-fake-provider** | `27dbc764a1890aad171cb6d414b5aaee7a188edb` | 2026-08-15 | 实施 Phase 3：实现 safeStorage 密钥安全存储与日志脱敏、图片预处理器、FakeVisionAdapter 及 ExternalVisionService 全链路。 |
| **vision-phase-4-openai-adapter** | `403f418ae81b9aa8244657cb7f31e0559ee869f2` | 2026-08-15 | 实施 Phase 4：实现 OpenAI 原生与 OpenAI-compatible (Qwen/通义千问等) 视觉适配器，完成 401/429/400 安全过滤/Schema 校验等 Mock HTTP 契约测试。 |






















