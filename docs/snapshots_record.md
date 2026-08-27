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
| **vision-phase-5-gemini-and-anthropic** | `ae75f784ceb1a6aad205694ca90479ec38554c31` | 2026-08-15 | 实施 Phase 5：实现 Gemini 1.5 与 Anthropic Claude 3.5 Sonnet 原生多模态视觉适配器，覆盖安全阻断/错误映射/Mock 契约测试。 |
| **vision-phase-6-ui-and-radar** | `05e42f520fe22cc2cc9e1fdb2728575ce107ef5f` | 2026-08-15 | 实施 Phase 6：实现交互式 SVG 多维雷达图组件、设置页外部模型密钥与连通性测试面板、大图画作雷达图侧边抽屉与精准 IPC 调度。 |
| **vision-phase-7-semantic-search-adr** | `5e686e5f84acac60eae835f24c1434d103bcc9db` | 2026-08-15 | 实施 Phase 7：建立多模态向量语义搜索架构任务书与 ADR 0006，完成视觉多维画像与语义向量搜索的架构解耦与演进定界。 |
| **fix-album-card-action-bar-gap** | `7091c83401bd49307ff43bab0cc54202625fb915` | 2026-08-15 | 修复相册/画集卡片顶部“筛选”与“···”操作条脱离封面容器导致的流式占位白边漏洞，将操作胶囊置入封面相对浮层并优化半透毛玻璃质感。 |
| **visual-audit-baseline-phase-1-4** | `0d6c809e4b3c7b79abe57b660ac4b70ce965d6fc` | 2026-08-15 | 实施全产品视觉审计 Phase 1~4：建立隔离 Fixture 与 Electron CDP 自动化巡检工具，全量捕获 22 份高保真截图并完成 10 维评估、矩阵覆盖与 VA 问题账本登记。 |
| **visual-audit-remediation-phase-5-6** | `dedb39b3be5f714a3b67a07a2d729d835c0877b3` | 2026-08-15 | 实施视觉审计闭环整改 Phase 5~6：消除 900×620 最小窗口 60px 溢出、重构外部 AI 视觉配置 Tokens、提升画册暗色舞台对比度、统一大图雷达画像抽屉与全局相册弹窗文案，全量 7 项 VA 问题全部闭环验证。 |
| **typography-phase-0-probes-and-adr** | `ae83e1d641cd0fdc09cf52ab37d21e5d671b6789` | 2026-08-15 | 实施排版与字体系统升级 Phase 0：完成样式硬编码热点扫描、Electron 43 Local Font Access 探针实测、Domain 领域契约/验证器与 ADR 0007 架构决策，全量通过单元测试与编译。 |
| **typography-phase-1-tokens-migration** | `98e2720299aa941090bb1f25145402a2609020af` | 2026-08-15 | 实施排版与字体系统升级 Phase 1：在 tokens.css 建立四槽位语义字体 Token 及排版规范变量，完成 collections.css、themes.css、vision-radar.css 样式热点无行为平滑迁移，门禁 100% 通过。 |
| **typography-phase-2-sandbox-and-protocol** | `9625fe272d540b22b15c890725da72195c423c32` | 2026-08-15 | 实施排版与字体系统升级 Phase 2：构建零依赖 SFNT 验证解析器、userData/fonts 沙箱原子索引、sanctuary-font:// 受控特权协议与 IPC 接入，单元测试与编译全部通过。 |
| **typography-phase-3-6-provider-and-settings** | `4df3e87ed6d54bce2c11917408caf0a7a8d79307` | 2026-08-15 | 实施排版与字体系统升级 Phase 3~6：实现 TypographyProvider 动态 CSS 变量注入与 FontFace 管理、设置中心 4 槽位选择/草稿生效/系统字体读取与导入管理面板，全产品视觉巡检验证通过。 |
| **photobook-3d-flip-and-photo-mounts** | `ca015cfeea843c020e6ed341182e91b54180b414` | 2026-08-15 | 实施画册 3D 拟真翻页动力学引擎与多风格实体相片装裱系统：实装 4 款独特装裱风格（典藏相角/和纸手账/画廊浮雕/复古拍立得）与顶部切换胶囊，重构以书脊为轴的 180° 3D 翻页叶片、书脊动态扫光与悬停卷角诱导动效。 |
| **photobook-flip-stutter-elimination** | `f0d4fa30fbf40908d23c0c56ecb662c031abe8b2` | 2026-08-15 | 消除画册翻页卡顿与人脑预测模型认知对齐：采用 onAnimationEnd 精准帧同步彻底消灭 DOM 替换时序撕裂，重构子组件保证翻页前后布局 100% 像素级对齐，引入符合真实纸张空气阻尼与惯性力学的 cubic-bezier(0.22, 1, 0.36, 1) 贝塞尔曲线。 |
| **photobook-flip-cushion-damping** | `dc65438ce688878cb300134d3615ad4451d8862b` | 2026-08-15 | 升级画册翻页节奏至 0.68s 并引入多阶段空气阻尼与纸张微弧度形变：重构 18% 柔和起势、48% 空间纵深扫光与 76% 气垫柔性降落，使重磅艺术画册翻折更具典藏沉浸仪式感。 |
| **photobook-flicker-free-4deck-stage** | `092b5bcf447244037fec0f5322d625e31054f3d1` | 2026-08-15 | 彻底重构画册为常驻四层硬装书台（Permanent 4-Deck Stage）：翻页叶片在 DOM 中永久驻留（零挂载/零卸载），正面与反面分别赋予 translateZ(+1.2px) 物理厚度隔离彻底根除 Z-Fighting 与 Compositor 纹理重建闪烁，配合 0.64s 典藏空气动力学衰减曲线。 |
| **photobook-double-spread-and-floating-toc** | `b16482a5c7468e68fee62087606235bc2f801eaf` | 2026-08-15 | 重构画册为全景双页对开画廊体系（Spread-based Layout）：第 1 展对为卷首题记与封面首作，后续内页展对左页与右页全部展示独立装裱画作，实装顶部/底部快捷入口与全局键盘快捷键 T 唤起的浮动亚克力毛玻璃篇目索引抽屉。 |
| **photobook-flash-fix-and-precaching** | `489db0533b9cd3e203afcf461de6f4d99b9a18f3` | 2026-08-15 | 彻底根除翻页过程中“先出现上一张图片又出现下一张图片”的时序穿透闪烁：引入相邻展对画作 GPU 显存级异步预解码与预加载（Pre-caching），重构 3D 翻页叶片为精确 keyed 独立渲染周期，彻底解决底层页面提前暴露与叶片复位跳跃。 |
| **photobook-eliminate-reload-flash** | `a583d8f5d623ee6ebecb3dab4bd86f3a210b3565` | 2026-08-15 | 彻底消除翻页时“像网页刷新一样白闪”的现象：移除强行销毁重建 DOM 的动态 key 属性让 React 原地复用稳定书台节点，引入全集画作进入相册瞬间的全局同步预解码（decoding=sync），杜绝 DOM 重建导致的布局空白与图片异步刷新。 |
| **photobook-atomic-spread-state-machine** | `9635e9a2fdf1000a60c6875ae39ad1aa4c5dab3d` | 2026-08-15 | 深度分析用户录屏发现翻页后左页短暂回退卷首的瞬间闪烁（Spread Reversion Glitch）：重构翻页展台为单一原子状态机（Unified Atomic State Machine），使 spread 索引更新与动画完成在同一渲染帧内完全原子化，彻底根除多状态不同步引发的闪现旧页问题。 |
| **photobook-split-phase-engine-and-doc** | `b53b381321ba7a43b55b5b7af39c10b293e6db45` | 2026-08-15 | 实装行业级双半程单面隔离折叠引擎（Split-Phase Single-Sided Folding Architecture）并输出权威图形学技术分析白皮书：废弃双面背靠背 3D 夹层，拆分为前半程右页单面起折与后半程左页单面展平，100% 免疫 Chromium backface-visibility 亚像素浮点穿透与 Z-Fighting。 |
| **photobook-soft-natural-paper-shadows** | `2a284cf2c55022a1d39b1720492c6e67cdae1536` | 2026-08-15 | 去除生硬的人工扫光遮罩与生硬的黑影突变：全面软化翻折关键帧阴影过渡（最大 alpha 从 0.40 降至细腻的 0.12），移除高反差镜面扫光层，呈现物理艺术画集原汁原味的柔和自然纸张起伏感。 |
| **photobook-continuous-aerodynamics-and-spine-anchor** | `b6bb5f43536ee0705e499184dc18690ded526699` | 2026-08-15 | 根治翻页阴影中途消失后突现与分段生硬停顿：重构为单张物理纸张 0°~180° 连续 3D 空气动力学平滑翻折，将中脊装订立体阴影提升至 z-index: 60 恒定置顶锚定，精确对齐脊线 0 圆角装订边缘，杜绝任何阴影断层与撕裂感。 |
| **photobook-clean-minimalist-gutter-seam** | `2af4e9f00f0d72b25b32981fe1df9300ffdabd42` | 2026-08-15 | 彻底废除正中突兀粗黑的重阴影竖条、点状缝线与丝带标记：全面回归现代高端艺术画册（Editorial Artbook）极简设计语言，将书台中缝净化为 1px 典雅细微中缝线，纯净还原两页对开画作本身。 |
| **photobook-multi-turn-transitions-suite** | `f69fcbb96df3432bee1d9358a34d24e7a743dc97` | 2026-08-15 | 实装 4 套高品质可自由切换的画册翻页动画（3D 典藏翻页、平移动画、柔光渐隐、层叠抽拉）：顶部双选择器工具栏、硬件 GPU Compositor Layer 隔离与 localStorage 偏好持久化，彻底解决不同设备环境下的卡顿与生硬感。 |
| **photobook-dual-spread-slide-track** | `52df7588235b365533411fbece60b25687157858` | 2026-08-15 | 彻底根除平移动画中左页提前暴露新图的异常：重构为全画幅 200% 宽度双展对连续平移轨道（Dual-Spread Track），使旧展对与新展对作为一个整体横向无缝推拉，底台全程冻结，实现真正电影级零闪现滑行。 |
| **photobook-rock-solid-frame-momentum-slide** | `b582e155b7d084f72ee473a83689a734881276a6` | 2026-08-15 | 彻底消除外框微缩放抖动与生硬减速阻尼：书台外框（Double Spread Frame）绝对静止（移除外部 transform 过渡，严格锁定内部 overflow 裁剪），平移采用 0.36s 纯净流体自然动量曲线 `cubic-bezier(0.25, 1, 0.5, 1)`，平移动画如丝绸般平稳顺滑。 |
| **workspace-rules-gemini-and-agents-sync** | `1d91169cf10cef7669db3da9e414b8f5f2bd57eb` | 2026-08-15 | 注册项目根目录 `GEMINI.md` 与 `AGENTS.md` 规则规范：使 Antigravity IDE UI Customizations 面板与 Agent 底层自动化规则引擎无缝双向发现，确保每次会话与任务均自动常驻加载并严格遵守设计工程学与人类体感物理法则。 |
| **workspace-modular-rules-directory-structure** | `39f596f43519d8acc2a709c8d957fcc7500887e8` | 2026-08-15 | 建立 `.agents/rules/` 模块化规则体系目录，拆分为 4 大专属规范文件并显式标注 Antigravity/Gemini 专属作用域，配置 `.gitignore` 放行规则保护，实现结构化组织与分层治理。 |
| **workspace-agent-governance-consolidated** | `236f9b7422459cd758805536252b1fe044bf921a` | 2026-08-15 | 去除 `GEMINI.md`、`AGENTS.md` 与模块规则三重重复，建立入口、跨模型底线和按作用域规则三层治理；收紧 Git 快照安全边界、GPU 合成适用范围，并明确画册 4 种装裱风格与 4 种翻页效果。 |
| **vision-element-inspector-and-triage-studio** | `3522bf7e` | 2026-08-18 | 实现交互式单图 AI 元素透视抽屉、自定义黑名单拦截规则、Pixiv 探索悬浮毛玻璃控制胶囊与独立智能清洗排查工坊 (Triage Studio)。 |
| **personal-prompt-bridge-and-local-comfyui** | `0d159e1` | 2026-08-24 | 完成模型版本隔离的标签三态调音台、模型适配提示词/复制/负向词库/预设、本机回环 ComfyUI 工作流与持久任务、多输出可信回收和生成来源追溯；区域遮罩因独立门槛未通过而保持不实现。 |
| **element-inspector-prompt-workspace-v2** | `b4efed052e87fb4eb09b35047396a6f9537e9fc0` | 2026-08-24 | 元素透视拆分为识别说明、本图提示词整理与探索拦截三页；Prompt Bridge v2 移除跨作品标签累计和置信度伪权重，只持久化格式、负向词库与主动预设，并保留当前本机 ComfyUI 显式发送链路。 |
| **data-preserving-release-0.1.1** | `9446f26` | 2026-08-27 | 产出可覆盖早期安装的 0.1.1 离线安装包，保留图库、偏好、登录状态和下载目录；同步安装器版本检测，并以隔离安装、WD Tagger 就绪与真实推理完成发布验收。 |













































