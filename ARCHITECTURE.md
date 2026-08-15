# 纯净领域架构与演进计划

- 文档状态：当前架构基线 + 后续演进计划
- 基线日期：2026-08-14
- 最近同步：探索审查闭环、可信 Pixiv 下载、本地画廊与作者两级浏览、显式模型整理、UI/UX 现代化设计系统重构及分类组合/组合视图（Saved Collection Views）已完成
- 面向读者：接手实现的开发者或代码模型

## 1. 产品边界

纯净领域是本地优先的 Pixiv 安全浏览与二次元图片管理桌面应用。它过滤的是用户明确不欢迎的**画面元素**，不是年龄分级。

必须保持的产品语义：

- 正常 R18、裸体、色情或擦边内容不是默认拦截目标。
- 猎奇、血腥、断肢和当前模型可覆盖的排泄相关元素才进入黑名单规则。
- 未知、下载失败、模型失败或超时必须失败闭合，不能先显示原图。
- 广告过滤与内容过滤是两条独立管线：广告看页面/网络语义，内容过滤看图片本身。
- 失败闭合只约束远程探索展示和明确要求模型分析的任务；用户主动保存的 Pixiv 作品属于可信输入，不自动运行模型，也不继承旧的模糊/隐藏判定。
- 不在 Electron 内嵌页运行第三方 OAuth，不伪装浏览器指纹，不读取账号凭据或复制系统浏览器 Cookie。

## 2. 当前运行架构

```mermaid
flowchart LR
  UI["本地 React UI"] -->|"窄 IPC"| MAIN["Electron 主进程"]
  MAIN --> DB["SQLite：图库、来源、规则与审查缓存"]
  MAIN --> VIEW["沙箱化 Pixiv WebContentsView"]
  VIEW -->|"作品图片请求"| REVIEW["探索审查协调器"]
  VIEW -->|"当前作品 / 收藏下载命令"| DOWNLOAD["Pixiv 下载协调器"]
  REVIEW -->|"临时审查副本"| CDN["i.pximg.net"]
  REVIEW -->|"文件路径 / JSON Lines"| VISION["Python WD Tagger 子进程"]
  VISION --> REVIEW
  DB -->|"元素阈值与缓存"| REVIEW
  REVIEW -->|"allow / cancel + 占位层"| VIEW
  DOWNLOAD -->|"严格校验 JSON 与原图 URL"| PIXIV["Pixiv AJAX / 原图 CDN"]
  DOWNLOAD -->|"临时文件 + 原子改名"| STORE["Pictures/Digital Sanctuary/Pixiv/作品 ID"]
  STORE -->|"受限 sanctuary-image 协议"| UI
  DOWNLOAD -->|"可信决策 + 作者/作品/页码"| DB
  VIEW -->|"广告、跟踪与站外 iframe"| ADBLOCK["网络级广告策略"]
```

### 2.1 前端 UI
- 基于 React 19，不依赖厚重 UI 库；建立统一的 **Design Tokens 系统**（基于 CSS 变量的蔚蓝主题色盘、多层级精密阴影、亚克力毛玻璃光影与系统字体中英文排版规范）。
- 渲染样式以 `styles.css` 作为只含有序 `@import` 的清单，实际规则位于 `renderer/src/styles/` 的 21 个职责模块中；`electron.vite.config.ts` 会在内存中按清单合成单一虚拟 CSS 模块，以兼顾源码边界、原有级联语义和大图库滚动性能。新增页面样式不得重新堆回清单文件，也不得绕过虚拟入口逐个导入。
- 渲染层按应用壳、画廊、探索、设置、作者、分类和原图查看器拆分。按钮、分段菜单、通知与对话框使用共享组件；对话框统一提供焦点约束、滚动锁定、`Esc` 关闭和忙碌保护。
- **画廊与卡片沉浸感**：顶部采用影院级 Ambient Hero 动态氛围横幅；作品卡片支持多页作品相纸堆叠（Stack Effect）视觉与悬浮升降微交互。
- **影院级大图全貌沉浸查看器（Cinema Lightbox）**：全景纯净舞台居中完整展示原图（Zero Crop / Full Aspect-Ratio）；支持鼠标滚轮无级缩放（`0.5x` ~ `5.0x`）、拖拽平移（Pan）、双击极速自适应/1:1 回弹切换；浮动毛玻璃控制胶囊在静止时自动隐匿；底部为多页作品提供半透明缩略图胶片轨道。
- **画集相册（Albums & Artbooks）全景双页对开画廊体系**：将分类相册全面升维为实体艺术画集体验；详情页采用精装对开展台（Spread-based Layout），第 1 展对为卷首题记与封面首作，后续内页左页与右页全部对开展出独立装裱画作；支持 4 种实体装裱风格（典藏相角、和纸手账、画廊浮雕、复古拍立得）；支持通过顶部胶囊与全局键盘快捷键 `T` / `M` 随时唤起【浮动亚克力毛玻璃篇目索引抽屉（Floating TOC Drawer）】进行模糊搜索与 3D 翻页平滑直达。
- **画册 3D 动力学引擎与单一原子状态机（Unified Atomic Spread State Machine）**：采用 0.64s 典藏空气动力学贝塞尔曲线与 2.4px 物理厚度微层，将当前展对与翻页转场收敛至不可分割的单一原子状态机，配合全集原画 GPU 显存级同步预解码（`decoding="sync"`）与预缓存，彻底根除时序穿透、图层复位跳跃与布局空白刷新闪烁。
- **字体排印与自定义字体系统（Typography & Custom Fonts Ecosystem）**：定义 4 大语义化字体槽位（界面无衬线、标题典藏衬线、代码等宽、画册手写体）；主进程内建零依赖 SFNT（TrueType/OpenType）二进制安全解析器与 SHA-256 指纹校验，支持字体文件拖拽/选择导入至 `userData/fonts/` 沙箱，通过受限 `sanctuary-font://` 协议与动态 `@font-face` 实现零重启热注入与个性化排版定制。
- **分类组合与组合视图（Saved Collection Views）**：相册页支持将多个普通相册组合为保存视图；支持多选包含/排除、实时防抖匹配数量与封面预览、拼贴卡片及画廊顶部组合条件摘要栏。
- **探索防线雷达 HUD**：将审查统计重构为彩色状态芯片组（放行绿 / 拦截红 / 广告黄 / 缓存紫 / 审查中蓝），提供清晰直观的实时吞吐监控。
- **三档性能与显示策略**：持久化精致（Quality）、均衡（Balanced）、省电（Efficient）三档，支持 reduced motion 优雅退化；大图库渐进分页与 `content-visibility` 跳过屏幕外绘制，当前 10,000 作品基准首屏约 564 ms、JS 堆约 22 MB。
- **动态主题引擎与个性化外观系统（全栈完成）**：前端视觉 tokens 与个性化样式解耦为标准化主题包（`theme.json` + `theme.css`）。主进程支持内置/用户主题扫描、文件夹与受限 ZIP 原子安装、活跃主题持久化、安全 CSS 读取、删除回退，以及带本地缓存和限流熔断的 GitHub Contents API 商店；渲染层实现 `<style id="ds-dynamic-theme">` 零刷新无缝热注入；开箱提供 4 套官方深度定制预设（庇护所标准蔚蓝、绝区零 Hollow Zero 潮酷暗调、樱落梦境 Sakura Dream 二次元粉彩、赛博终端 Cyber Deck 霓虹矩阵）；支持用户在设置中心自定义上传个人头像并同步展示于侧边栏品牌区。
- **360° 交互式动力学星盘罗盘（Interactive Compass Dial）**：内嵌于画廊顶部 Ambient Hero 氛围横幅中；采用三角函数极坐标（`Math.atan2`）捕获鼠标转圈拖拽手势，驱动多层差速齿轮（Parallax Differential Rings）、发光磁性指针、12点钟基准对齐指示箭头与物理惯性阻尼衰减（Momentum Damping），实现充满游戏生命力的 360° 无级旋转拨盘换肤互动。

### 2.2 Electron 主进程

- `apps/desktop/src/main/index.ts`：当前仍是组合根，负责窗口、IPC、Pixiv 视图、网络拦截、远程图片审查、下载协调和视觉进程生命周期。
- 主进程启动时申请 Electron 单实例锁；重复启动只唤醒现有窗口，不创建第二个 Pixiv session/view。
- `apps/desktop/src/main/explore-policy.ts`：可单元测试的 URL、权限、广告和资源策略。
- `apps/desktop/src/main/pixiv-dom-adapter.ts`：幂等注入拦截占位层、“仅本次查看”和作品页下载按钮。宽泛的第一方 PR/BOOTH DOM 猜测已经移除，避免再次误伤普通作品。
- `apps/desktop/src/main/thumbnail-service.ts`：独立的版本化缩略图批处理器。每次只串行处理小批资产，缓存命中直接回填路径；缓存文件缺失时自动重新排队。
- `apps/desktop/src/main/saved-collection-view-ipc.ts`：分类组合 CRUD 的运行时校验与 IPC 边界，限制名称、条件数量、ID 长度及包含/排除冲突。
- `apps/desktop/src/main/theme/`：主题清单/商店协议校验、CSS 与路径安全边界、ZIP 解包、原子安装管理、GitHub 商店缓存代理和主题 IPC；服务在首次主题请求时才扫描目录，不阻塞首屏窗口创建。
- `apps/desktop/src/shared/pixiv-download.ts`：Pixiv 页面上下文、AJAX 响应和原图 URL 的纯函数校验。
- `apps/desktop/src/shared/bounded-concurrency.ts`：下载任务使用的通用并发门。收藏作品按顺序处理，单作品内部原图最多四路；Pixiv JSON API 全局间隔至少 800 ms。
- **有界重试**：429、网络异常和 5xx 最多重试两次，单次等待不超过 30 秒；仍失败时抛出批次级错误并停止，不把同一全局故障记成数百个作品失败。
- **连续失败熔断**：下架或无权限作品可以单项跳过，但连续 5 项失败自动停止。403 不再盲目等待 15 分钟。
- **结果语义**：零失败才显示“下载完成”；有成功也有失败时显示“部分完成”，作品进度按“已处理 = 成功 + 失败”计算。
- `apps/desktop/src/main/explore-review-queue.ts` 与 `apps/desktop/src/preload/explore.ts`：视口优先审查实验。因 KI-0004 默认关闭，当前生产路径仍在网络回调中串行审查。
- `apps/desktop/src/main/vision-client.ts`：版本化 JSON Lines 客户端、超时和子进程错误处理。
- Pixiv 使用 `persist:pixiv` 独立持久化 session；本地 React 渲染器不能访问其 DOM 或 Cookie。单实例锁避免多个进程造成“登录一次却看似丢失会话”的错觉。

### 2.3 视觉与领域层

- `services/vision/python/`：WD SwinV2 Tagger v3 推理实现。
- `packages/domain/`：元素组、阈值、标签映射、SavedCollectionView 和 `allow / blur / hide` 决策。
- `packages/protocol/`：桌面端与视觉子进程之间的协议。
- `packages/database/`：本地图库、自定义画廊分类（含封面绑定）、分类组合视图（`saved_collection_views` 表，版本 3 迁移）、独立画师表（含头像快照）、Pixiv 作品来源、元素规则设置和远程审查缓存。组合视图的 schema、CRUD、唯一名称约束和损坏 JSON 降级集中在 `saved-collection-view-store.ts`。
- 开发环境检测到 `.venv-gpu` 时优先请求 CUDA，初始化失败回退 CPU。RTX 4050 基准中单图中位数约由 463 ms 降至 72 ms；provider 选择不改变模型版本和缓存语义。

## 3. 当前探索请求流

1. Pixiv 请求普通界面图片、头像或登录素材：直接放行。
2. 请求命中广告/追踪域名：网络层取消，并增加“广告拦截”计数。
3. 请求是非 Pixiv 第三方 iframe：默认取消；`accounts.pixiv.net` 登录页所需的 reCAPTCHA 是窄例外。
4. 请求是视频：当前失败闭合并取消。
5. 请求是 `i.pximg.net` 的 `img-master`、`img-original` 或 `custom-thumb` 作品图：
   - 相同 URL 在进程内去重；
   - 先按规范化 URL、引擎、引擎版本和规则指纹查询持久化缓存；
   - 缓存命中完整结果时直接决定 allow/block，不下载或重复推理；
   - 带 Pixiv `Referer` 下载不超过 12 MiB 的临时副本；
   - 串行交给 WD Tagger，避免并发请求的超时从排队阶段开始累计；
   - 使用数据库中的当前元素规则判定；
   - `allow` 后恢复原始网络请求；其他结果取消原始请求并注入本地占位层；
   - 占位层显示命中原因；用户点击“仅本次查看”后通过受限消息通道请求单 URL 单次放行，不写入永久 `allow` 缓存；
   - 推理后删除临时文件。

当前未命中缓存时仍会为审查下载一次图片、放行后由页面再下载一次。它是安全的最小闭环，但不是最终的网络效率形态。

### 3.1 当前 Pixiv 下载与画廊流

1. 只有作品详情页允许“保存当前作品”；只有收藏作品页允许“下载全部收藏”。网页内按钮携带的作品 ID 必须与当前顶层 URL 一致。
2. 主进程通过登录 session 获取作品页清单、作者信息和公开/非公开收藏 ID；所有 JSON 响应和 `i.pximg.net` 原图 URL 都经过严格校验。
3. 原图请求绕开探索页内容拦截器，使用 Pixiv 作品页 `Referer`、流式临时文件和原子改名；全局网络并发上限为 4。
4. 文件保存在用户“图片/Digital Sanctuary/Pixiv/作品 ID”中；已索引页码连续、文件存在且作者资料已经入库的作品触发本地快速跳过。所有 Pixiv JSON API 请求接入 800 ms 全局节流。
5. 所有用户主动下载都调用 `trustArtwork`：清除旧模型结果并保存明确的 `allow` 决策，不自动运行 WD Tagger。
6. SQLite 保存 `workId`、`pageIndex`、`authorId`、`authorName` 和标题；分离画师实体独立入库。头像不再猜测作品 JSON，而是从 `/ajax/user/:authorId?full=1` 的 `imageBig` 获取并保存本地快照；画廊也提供不重下作品的显式补全入口。
7. 本地图片仅通过 `sanctuary-image` 自定义协议返回，并且只有数据库已索引、文件仍存在的路径可以读取。
8. 画廊提供基于分类组合（Saved Views）的虚拟布尔筛选（AND / OR / NOT），支持多分类复合查询，不复制或修改底层作品文件与分类实体。

## 4. 安全不变量

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`。
- 顶层导航只允许 HTTPS `pixiv.net` 及子域。
- 弹窗、下载和权限默认拒绝；例外必须是可测试的窄规则。
- 远程 Pixiv 页面不获得本地文件、数据库、视觉进程或通用 IPC 权限。
- 系统浏览器入口只能打开代码中固定的 Pixiv 官方密码设置 URL。
- 过滤规则变化后必须使旧的远程审查缓存失效。
- 任何缓存键必须包含模型/引擎版本和规则指纹，不能把旧模型的 `allow` 永久复用。
- 被拦截图片必须先取消原请求再显示占位层；一次性查看必须是明确的单张图片操作，且不能改变持久化缓存。
- 远程 Pixiv 页面不能直接指定下载目标路径；所有作品 ID、原图域名、扩展名、文件上限和落盘目录由主进程重新验证或生成。
- “用户信任”和“模型分析”是不同概念。未来的图库整理模型只能写标签或建议，未经用户确认不能把主动下载作品改为模糊/隐藏。

## 5. 广告过滤分层

广告过滤不能与元素黑名单混为一谈：

1. **网络级过滤（已实现并保留）**：拦截已知广告/追踪域名和站外 iframe，降低请求数与渲染进程数。
2. **Pixiv 第一方美容过滤（冻结）**：旧的 DOM 祖先猜测曾引发 KI-0003，把普通作品列表整块隐藏，现已移除。第一方 PR/BOOTH 卡片可能继续出现，当前优先使用 Pixiv Premium 官方广告开关；若以后恢复，必须采用标准规则引擎或有夹具覆盖的精确适配器。

第一方广告与普通作品共用 Pixiv 域名和图片 CDN，不能封禁整个 `pixiv.net`/`pximg.net`，也不能把广告插画当作不欢迎元素送入 WD Tagger。

## 6. 主进程模块边界

发布收尾已经抽出并测试以下稳定边界：

- `window-state.ts`：多显示器窗口状态校验与安全收敛；
- `library-ipc.ts`：作品查询、详情读取和缩略图批任务 IPC；
- `saved-collection-view-ipc.ts` / `packages/database/src/saved-collection-view-store.ts`：分类组合输入校验、IPC 注册与 SQLite 持久化；
- `analysis-ipc.ts` / `analysis-job-runner.ts`：显式分析 API 与严格串行、可取消的执行器；
- `explore-policy.ts`、`explore-review-queue.ts`、`pixiv-dom-adapter.ts`：导航/广告策略、审查队列和远程 DOM 适配；
- `shared/pixiv-download.ts` / `shared/bounded-concurrency.ts`：Pixiv 响应解析、下载状态和并发原语；
- `thumbnail-service.ts`、`vision-client.ts`：缩略图缓存和模型子进程协议。

`index.ts` 仍负责 Electron 生命周期和需要共享 Pixiv session 的下载/探索协调。继续迁移时沿用下面的控制器目标，不在发布收尾阶段重写已经通过回归的远程请求链路。

在继续扩大功能前，将 `apps/desktop/src/main/index.ts` 中的探索逻辑逐步迁移为：

```text
apps/desktop/src/main/explore/
  controller.ts              # WebContentsView 生命周期与状态汇总
  navigation-policy.ts       # 顶层导航、弹窗、权限和下载
  adblock-policy.ts          # 广告域名和站外 iframe 策略
  pixiv-url-adapter.ts       # 作品 CDN URL 识别与规范化
  pixiv-dom-adapter.ts       # 第一方 PR 卡片、占位层和页面结构探针
  review-coordinator.ts      # 去重、排队、下载、判定和统计
  review-cache.ts            # SQLite 持久化审查缓存
  types.ts                   # ExploreState 等共享主进程类型

apps/desktop/src/main/download/
  controller.ts              # 单作品与收藏任务、进度和取消边界
  pixiv-api.ts               # 登录 session 下的 Pixiv AJAX 访问
  original-fetch.ts          # 原图流式下载、限流、临时文件与原子改名

apps/desktop/src/main/library/
  controller.ts              # 导入、可信下载入库与显式模型整理入口
```

迁移必须小步进行：先复制测试覆盖，再移动代码，不要一次性重写 `index.ts`。

## 7. 持久化审查缓存计划

SQLite 已增加并使用 `remote_image_reviews`：

```sql
CREATE TABLE remote_image_reviews (
  normalized_url TEXT NOT NULL,
  content_hash TEXT,
  engine TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  rules_fingerprint TEXT NOT NULL,
  assessment_json TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,
  PRIMARY KEY (normalized_url, engine, engine_version, rules_fingerprint)
);
```

实施要求：

- 只缓存完整、可解析的审查结果；网络错误和模型错误不应成为永久记录。
- 规则指纹由启用状态、标签、阈值和动作的稳定序列计算。
- 模型或标签表版本变化时不能复用旧结果。
- 设定容量/时间清理策略；不要永久保存远程图片文件。
- 若未来用内容哈希跨 URL 复用，仍要验证响应内容，不能只相信 URL 参数。
- 当前默认在应用启动时清理超过 30 天或超出 2,000 条的记录；只保存 `status=complete` 结果。

## 8. 显式模型整理边界

模型整理使用 `analysis_jobs`、`analysis_job_items` 和 `analysis_asset_results`，不复用旧 `artworks.assessment_json` 作为画廊展示信任：

- 只有用户预览范围并点击开始后，任务才进入串行模型队列；启动、滚动和下载不会触发任务。
- 范围保存为不可变的作用域快照；任务项落实到当时可用的本地图片资产。
- 资产更新时间与引擎一致时可以复用完整分析；文件或引擎变化后必须重新推理。
- 取消在当前单张推理结束后生效；异常退出会把 `running` 任务标为失败，不自动恢复运行。
- 标签建议与探索拦截、主动下载信任完全分离；只有用户勾选并确认的建议才创建分类关系。

## 9. 近期架构里程碑

1. **已完成**：元素黑名单、远程失败闭合、持久化审查缓存、占位层和一次性查看。
2. **已完成**：作品全部页保存、公开/非公开收藏批量下载、四路限流、原子落盘、去重与来源元数据。
3. **已完成**：主动下载信任边界、原图懒加载、平铺/作者两级浏览和沉浸式大图层。
4. **已完成**：MVP 画廊资产管理重构，引入独立 `ArtistRecord`（本地头像）并扩展 `CollectionRecord`（自定义封面与分类详情浏览）。
5. **冻结**：第一方广告美容过滤；宽泛 DOM 方案不得恢复。视口审查实验保持关闭，直到本地 fixture 能覆盖候选上报到图片重载的完整链路。
6. **已完成**：作品级数据迁移、数据库查询/分页、安全删除、共享交互组件以及画廊/探索/设置组件边界。
7. **已完成**：版本化缩略图、自动分页和屏幕外绘制跳过已经接入；真实 Electron 10,000 作品基准覆盖首屏、连续触底、内存门槛和图片元素计数。
8. **已完成**：模型整理采用显式范围预览、持久任务、取消、缓存和二次确认的分类建议流程；分析结果与展示信任状态分表保存。
9. **已完成**：UI/UX 现代化二次元极简设计系统重构；引入 Design Tokens、影院级 Ambient Hero、多页作品相纸堆叠视觉、大图悬浮控制台与探索防线雷达 HUD。
10. **已完成**：主进程模块化拆分、一致性备份与 Windows 打包验收。
11. **已完成**：分类组合与组合视图（Saved Collection Views）；支持多分类交集（AND）、并集（OR）、排除（NOT）复杂查询与实时防抖预览，数据库迁移至版本 3。
12. **已完成**：动态主题生态与 360° 动力学星盘罗盘；支持标准化主题包安装、GitHub 商店与物理惯性拨盘换肤。
13. **已完成**：字体排印与本地自定义字体系统（Typography）；4 大语义化槽位、SFNT 安全二进制解析器、`userData/fonts/` 沙箱、`sanctuary-font://` 协议与动态热注入。
14. **已完成**：实体级全景双页对开画册（Double-Spread Photobook）与 3D 动力学原子状态机；4 种装裱风格、浮动毛玻璃目录抽屉、GPU 预解码与零时序穿透 3D 翻页。

详细任务与止损条件见 `docs/plans/ACTIVE_ROADMAP.md`，验收步骤见 `docs/handoff/02_VERIFICATION_CHECKLIST.md`。
