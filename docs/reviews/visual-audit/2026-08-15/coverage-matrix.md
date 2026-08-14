# 纯净领域视觉审计覆盖矩阵（Coverage Matrix）

- 审计日期：2026-08-15
- 审计基线：`d6086f1`
- 规则：每个格子必须标记 `pass`、`issue: VA-xxx`、`blocked: 原因` 或 `not-applicable`，禁止留空。

---

## 1. 视口尺寸覆盖矩阵 (Viewports)

| 页面 / 核心交互场景 | W1 (900×620 最小) | W2 (1280×720 笔记本) | W3 (1440×900 基准) | W4 (1920×1080 全高清) |
|---|---|---|---|---|
| **应用全局壳层 (App Shell / Sidebar)** | `issue: VA-001` | `pass` | `pass` | `pass` |
| **画廊全景网格 (Gallery 60+ Works)** | `issue: VA-001` | `pass` | `pass` | `pass` |
| **画廊 Hero 罗盘横幅 (Compass Dial)** | `issue: VA-001` | `pass` | `pass` | `pass` |
| **相册画集封面墙 (Albums Grid)** | `issue: VA-001` | `pass` | `pass` | `pass` |
| **画册详情与翻页 (Album Detail / TOC)** | `issue: VA-001` | `pass` | `issue: VA-003, VA-004` | `pass` |
| **画师馆藏画廊 (Authors Gallery)** | `pass` | `pass` | `issue: VA-005` | `pass` |
| **大图影院查看器 (Cinema Lightbox)** | `pass` | `pass` | `issue: VA-006` | `pass` |
| **大图缩放与平移 (Zoom & Pan 200%)** | `pass` | `pass` | `pass` | `pass` |
| **设置中心 (Settings General)** | `issue: VA-001` | `pass` | `pass` | `pass` |
| **设置中心 AI 视觉配置 (Vision Settings)** | `issue: VA-001` | `pass` | `issue: VA-002` | `pass` |
| **模型整理任务中心 (Model Analysis)** | `pass` | `pass` | `pass` | `pass` |
| **探索安全防线 (Explore & Safety HUD)** | `pass` | `pass` | `pass` | `pass` |
| **新建相册模态弹窗 (New Collection Modal)** | `pass` | `pass` | `issue: VA-007` | `pass` |
| **相册组合视图编辑器 (Saved View Editor)** | `pass` | `pass` | `issue: VA-007` | `pass` |

---

## 2. 主题系统覆盖矩阵 (Themes)

| 页面 / 核心交互场景 | Default (蔚蓝浅色) | Sakura Dream (粉彩二次元) | Cyber Deck (赛博霓虹) | Hollow Zero (潮酷暗调) |
|---|---|---|---|---|
| **画廊全景 (Gallery)** | `pass` | `pass` | `pass` | `pass` |
| **Hero 罗盘动态换肤 (Compass)** | `pass` | `pass` | `pass` | `pass` |
| **相册画集卡片 (Album Cards)** | `pass` | `pass` | `pass` | `pass` |
| **设置中心 (Settings)** | `issue: VA-002` | `pass` | `pass` | `pass` |
| **大图沉浸舞台 (Lightbox Stage)** | `pass` | `pass` | `pass` | `pass` |
| **多维雷达图画像 (Radar Chart)** | `pass` | `pass` | `pass` | `pass` |

---

## 3. 显示性能档位覆盖矩阵 (Display Profiles)

| 场景 | Quality (精致) | Balanced (均衡) | Efficient (省电) |
|---|---|---|---|
| **60+ 画作瀑布流平滑滚动** | `pass` | `pass` | `pass` |
| **画册 3D 翻页与光影过渡** | `pass` | `pass` | `pass` (降级无过渡) |
| **360° 罗盘阻尼惯性转盘** | `pass` | `pass` | `pass` (降级线性拨动) |
