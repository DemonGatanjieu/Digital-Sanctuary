# AI 雷达与外部视觉服务实施规划（修订版）

> 状态：待实施  
> 规划日期：2026-08-14  
> 原始需求：`docs/plans/TASK_AI_RADAR_AND_EXTERNAL_VISION_FOR_GPT.md`  
> 执行对象：Gemini（按阶段逐项实现，禁止一次性大改）

## 1. 评估结论

该方向值得继续，但原始任务不能直接整包实施。它把四件性质不同的能力放进了同一期：

1. 本地、确定性的图像技术特征；
2. 外部视觉模型给出的主观审美解释；
3. 画廊中的雷达图展示与筛选；
4. 需要向量模型和检索索引的语义搜索。

如果直接照原稿落地，会出现以下问题：

- 用色彩熵、边缘密度等低层特征推导“构图、氛围、独特性、萌感”等艺术评价，结论没有可靠依据；
- 不同供应商、模型和提示词的分数不可直接横向比较；
- `ArtworkRadarEvaluation`、`ArtworkRadarScore` 命名不一致，`artworkId` 也与当前 `Work + Asset` 数据模型冲突；
- 配置类型携带明文 `apiKey`，不符合 Electron 密钥安全要求；
- 单作品即时 IPC 会绕开现有显式分析任务、取消、缓存和失败恢复机制；
- “语义搜索”只有目标，没有 embedding、索引、查询和版本设计；
- 自动分析会破坏现有产品边界：主动下载的作品默认可信，不得因模型结果自动模糊或隐藏。

因此本规划给出的结论是：**有条件通过，拆分实施。**

MVP 只完成两类独立能力：

- `technical_visual_v1`：本地技术视觉画像，强调“描述”，不声称审美优劣；
- 外部视觉套件：明确标注为“AI 主观解读”，只能由用户显式触发。

语义搜索另立任务，动态维度高光与固定维度雷达分开呈现。

---

## 2. 不可破坏的现有边界

Gemini 实施时必须保留以下规则：

1. `Work` 是作品，`Asset` 是作品中的具体页或本地文件；禁止重新引入旧式 `ArtworkRecord` 作为主模型。
2. Renderer 只能提交 `workId`、`assetId` 或已定义的分析范围，不能向主进程传任意文件路径。
3. 主进程负责从数据库解析受管理的本地文件，并验证路径确实属于画廊索引。
4. 用户主动下载的作品默认可信；分析结果只能成为元数据，不能自动改变隐藏、模糊、信任或删除状态。
5. 外部上传必须显式预览、显式确认；不能在启动、滚动、打开灯箱或下载完成时自动发生。
6. 复用现有 `analysis_jobs`、`analysis_job_items`、取消机制与缓存思路，不另造不可恢复的临时队列。
7. 保持 Electron 的 `contextIsolation`、sandbox 和最小 preload API；Renderer 禁止直接请求外部模型服务。
8. 数据库只能添加向前迁移（当前之后的新版本），不能改写已经发布的旧迁移。

---

## 3. 产品语义修订

### 3.1 本地结果不叫“审美评分”

本地分析建议命名为“技术视觉画像”，固定套件 `technical_visual_v1`，可包含：

- `colorfulness`：色彩丰富度；
- `tonal_range`：明暗跨度；
- `luminance_balance`：亮度分布均衡度；
- `edge_density`：边缘密度；
- `sharpness_proxy`：清晰度代理值；
- `spatial_balance`：空间分布平衡度。

这些值只描述图像统计特征。不要把它们改名为“艺术性、构图质量、氛围感、独特性”，也不要合成“总审美分”。

UI 应解释为：

> 本地技术画像由确定性图像特征计算，用于整理和比较视觉特征，不代表作品质量。

### 3.2 外部结果必须标为主观解释

外部模型可以输出固定评价套件，但 UI 必须显示：

- 供应商；
- 模型；
- 套件版本；
- 分析时间；
- “AI 主观解读”标记。

固定维度套件才适合雷达图和筛选。例如建议首先实现：

#### `fine_art_v1`

- composition
- color_harmony
- lighting
- visual_focus
- atmosphere
- detail_control

#### `character_presence_v1`

- expression
- pose_dynamism
- costume_detail
- focal_clarity
- silhouette
- palette_harmony

不建议把“涩气值”作为默认维度。二次元人物年龄经常无法从图片可靠判断，成人化评价不应成为自动批量分析的默认行为。如以后确实需要，应作为用户自行创建、明确启用的成人专用套件另行设计。

### 3.3 动态维度不能冒充固定雷达

`ai_adaptive_highlights` 可以让模型为单张作品选择 3～6 个亮点，但不同作品的轴不同，不能用于横向比较、排序或雷达筛选。

它应保存为独立的“作品亮点列表”：

```ts
interface AdaptiveHighlight {
  key: string;
  label: string;
  score: number; // 0..100
  reason?: string;
}
```

UI 用标签、条形值或短评呈现，不与固定雷达共用筛选逻辑。

### 3.4 语义搜索从本任务移出

外部模型生成的评分和文字说明不等同于语义向量。真正的语义搜索至少需要：

- embedding 模型与版本；
- 每个 Asset/Work 的向量；
- 向量存储与相似度索引；
- 查询文本的 embedding；
- 增量更新和模型升级后的重建策略。

本任务只预留扩展点，不实现“自然语言搜图”。后续单独建立 `TASK_SEMANTIC_SEARCH_AND_EMBEDDINGS.md`。

---

## 4. 修订后的领域模型

### 4.1 核心类型

建议不要继续使用原稿中的互相冲突类型，统一为：

```ts
type VisionEvaluationKind =
  | 'local_technical_profile'
  | 'external_fixed_suite'
  | 'external_adaptive_highlights';

type VisionEvaluationStatus =
  | 'success'
  | 'unsupported'
  | 'content_blocked'
  | 'auth_error'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'timeout'
  | 'network_error'
  | 'invalid_response'
  | 'cancelled'
  | 'skipped';

interface VisionDimensionScore {
  key: string;
  label: string;
  score: number; // 0..100
  explanation?: string;
}

interface VisionEvaluationResult {
  id: string;
  workId: string;
  assetId: string;
  scope: 'cover_asset';
  kind: VisionEvaluationKind;
  suiteId: string;
  suiteVersion: number;
  status: VisionEvaluationStatus;
  reasonCode?: string;
  dimensions: VisionDimensionScore[];
  summary?: string;
  providerId?: string;
  modelId?: string;
  createdAt: string;
}
```

MVP 对多页作品只分析封面 Asset，并把 `scope: 'cover_asset'` 明确写入结果。以后支持逐页分析时，必须新增范围而不是悄悄改变现有语义。

### 4.2 缓存身份

缓存命中不能只看 `assetId + engine`。一个可靠的结果身份至少包括：

```text
asset identity/version or content hash
+ evaluation kind
+ suite id/version
+ provider id
+ model id
+ evaluator version
+ prompt version
+ preprocessing fingerprint
```

任何模型、提示词、预处理或套件变化都必须生成新结果，不允许错误复用旧分数。

不同模型的结果可以并存，但默认 UI 不应把它们混入同一排序集合。

---

## 5. 数据库规划

新增一次前向迁移。确切迁移编号以实施时当前 schema 版本为准，禁止硬改已有迁移。

### 5.1 `vision_evaluation_results`

建议字段：

```text
id TEXT PRIMARY KEY
work_id TEXT NOT NULL
asset_id TEXT NOT NULL
scope TEXT NOT NULL
kind TEXT NOT NULL
suite_id TEXT NOT NULL
suite_version INTEGER NOT NULL
status TEXT NOT NULL
reason_code TEXT NULL
summary TEXT NULL
provider_id TEXT NULL
model_id TEXT NULL
evaluator_version TEXT NOT NULL
prompt_version TEXT NULL
preprocessing_fingerprint TEXT NOT NULL
asset_version TEXT NOT NULL
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

需要建立至少以下索引：

- `(work_id, created_at)`；
- `(asset_id, kind, suite_id, created_at)`；
- 完整缓存身份的唯一索引或等价查询约束。

### 5.2 `vision_dimension_scores`

```text
result_id TEXT NOT NULL
dimension_key TEXT NOT NULL
label TEXT NOT NULL
score REAL NOT NULL CHECK(score >= 0 AND score <= 100)
explanation TEXT NULL
PRIMARY KEY(result_id, dimension_key)
```

不能只把维度存在 JSON 中，因为以后需要执行“色彩丰富度大于 80”一类数据库筛选。JSON 可作为兼容快照，但规范数据应可索引。

### 5.3 外部请求审计

可新增 `external_vision_requests`，只记录：

- job/item/result ID；
- provider/model；
- 状态和稳定 reason code；
- 延迟；
- 供应商返回的 token/usage（若有）；
- 尝试次数；
- 时间戳。

禁止保存上传图片、base64、完整授权头、API Key 或未经裁剪的原始响应。原始响应如确需调试，只允许开发模式短期、脱敏、可关闭地记录。

---

## 6. API Key 与外部请求安全

### 6.1 密钥存储

禁止：

- 把 `apiKey` 放入会返回 Renderer 的配置对象；
- 写入 SQLite、普通 JSON preferences、日志或异常文本；
- 通过通用 IPC 读取原始密钥。

正确实现：

1. Renderer 只提交一次新密钥给专用 preload 方法；
2. 主进程使用 Electron `safeStorage.encryptString()` 加密；
3. 密文保存在 app `userData` 下的专用 secret store；
4. 对 Renderer 只返回 `hasApiKey` 和可选的掩码提示；
5. 如果当前系统不能安全加密，则只允许会话级密钥或拒绝持久化，并向用户说明。

建议公开配置：

```ts
interface ExternalVisionPublicConfig {
  id: string;
  provider: 'openai' | 'gemini' | 'anthropic' | 'openai_compatible';
  model: string;
  endpoint?: string;
  hasApiKey: boolean;
  keyHint?: string;
  enabled: boolean;
  maxConcurrency: number;
  maxLongEdge: number;
}
```

### 6.2 上传前预处理

主进程应把已索引 Asset 交给受控预处理器：

1. 验证文件归属和存在性；
2. 应用 EXIF orientation；
3. 对动画明确使用首帧，或返回 `unsupported`，不得因供应商不同而表现不一致；
4. 缩放到统一长边上限（建议默认 1568px，可配置）；
5. 去除 EXIF、ICC 之外不必要的元数据；
6. 转成供应商支持的 JPEG/PNG/WebP；
7. 限制上传字节数；
8. 在 `finally` 中删除临时文件和内存 base64 引用。

上传预览必须告诉用户：作品数、页数、预计上传量、供应商、模型、并发上限，以及外部服务可能产生费用和隐私风险。

### 6.3 自定义 Endpoint

默认只允许 HTTPS。需校验：

- 禁止 URL 中携带用户名、密码或 fragment；
- 禁止 HTTPS 重定向降级到 HTTP；
- 设置连接、读取、总超时；
- 限制响应体大小；
- 默认拒绝本地网络地址，除非用户开启“本地兼容服务”显式开关。

---

## 7. Provider Adapter 设计

不要把某个供应商的请求格式写进 job runner 或 UI。统一接口：

```ts
interface ExternalVisionAdapter {
  readonly providerId: string;

  analyze(input: {
    image: PreparedVisionImage;
    suite: FixedVisionSuite | AdaptiveHighlightSuite;
    model: string;
    signal: AbortSignal;
  }): Promise<ExternalVisionAdapterResult>;
}
```

实现顺序建议：

1. `FakeVisionAdapter`：固定 fixture，先打通任务、数据库、取消和 UI；
2. OpenAI 原生 adapter；
3. OpenAI-compatible adapter，可覆盖 Qwen/DashScope 等兼容服务；
4. Gemini 原生 adapter；
5. Anthropic 原生 adapter。

不要硬编码旧模型名称。模型名称由用户配置或受控默认值提供，并在结果中永久记录。

即使供应商支持 structured output，也必须在本地做运行时验证：

- JSON schema/validator 校验；
- 维度 key 必须与固定套件完全一致；
- 分数必须是有限数且位于 0～100；
- 文本长度受限；
- 多余字段丢弃；
- 验证失败写入 `invalid_response`，不得伪装成成功。

### 7.1 错误分类

HTTP 状态不能粗暴一一映射：400 不一定是内容拦截，429 也不一定就是配额耗尽。adapter 应结合状态码和结构化错误体映射为稳定 reason code。

最少处理：

- 401/403：认证或权限；
- 408/网络超时：timeout；
- 429：rate limited 或 quota exhausted；
- 5xx：可重试的供应商错误；
- 内容拒绝：content blocked；
- JSON/schema 不匹配：invalid response；
- 用户取消：cancelled。

UI 翻译稳定 reason code，不直接展示供应商原始错误全文。

---

## 8. 任务队列与执行流程

在现有显式分析任务上扩展“任务种类”，不要新建一套一次性 IPC。

建议流程：

```text
用户选择范围
  -> 主进程解析 Work 与封面 Asset
  -> 计算已缓存 / 待分析 / 不支持 / 缺失文件
  -> UI 展示范围、上传量、供应商、可能费用
  -> 用户确认
  -> 创建 analysis job + items
  -> runner 按并发限制执行
  -> 每项保存成功或明确失败状态
  -> 支持取消、重试失败项和恢复未完成任务
```

默认外部并发为 1；上限应保守。必须：

- 遵守 `Retry-After`；
- 只对明确可重试错误进行有限次数重试；
- 使用指数退避和抖动；
- 支持 `AbortSignal`；
- 允许部分成功；
- 失败项不阻止整个任务写入完成摘要；
- 提供单次任务最大作品数/上传量预算；
- 后续可增加月度预算，但不要用不可靠价格表伪装成精确费用。

“测试连接”可能产生模型请求费用。按钮应标为“发送一次测试请求”，并说明会上传内置测试图；如果供应商能用无费用的模型列表/认证接口验证，则优先使用它。

---

## 9. UI 规划

### 9.1 设置页

新增“外部视觉服务”区域：

- provider；
- model；
- endpoint（仅兼容服务）；
- API Key 输入/替换/删除；
- `hasApiKey` 状态，绝不回显原密钥；
- 上传尺寸；
- 并发数；
- 隐私提示；
- 明确标价风险的测试按钮。

### 9.2 分析入口

入口应放在作品灯箱/详情抽屉和批量管理菜单中，文案区分：

- “生成本地技术画像”；
- “使用外部 AI 解读……”；

外部入口点击后先弹 scope preview，绝不直接上传。

### 9.3 结果展示

创建一个共享 SVG 雷达组件，并保证：

- 固定套件才显示雷达；
- 响应式、键盘可访问；
- 颜色不作为唯一信息载体；
- 显示数值和维度说明；
- 本地画像与外部主观评分有明显标签区分；
- 多模型结果默认分标签查看，不叠成看似可比的一张图；
- 动态亮点用卡片/标签列表，不使用固定雷达。

先接入稳定的作品信息抽屉。不要为了这项功能同时重构 3D 画册、灯箱导航或主题系统；这些 UI 链条应保持解耦。

### 9.4 筛选

MVP 只允许在“同套件 + 同版本 + 同 provider/model”的结果集合内筛选。筛选条件必须显示当前评价来源，避免把不同模型的 80 分混在一起。

---

## 10. 分阶段执行清单

Gemini 每完成一个阶段都要运行 `npm run verify`，并单独提交。任何阶段失败都先修复，不得把未验证的大改堆到下一阶段。

### Phase 0：规格冻结与测试基线

- [ ] 根据本规划统一类型、命名和边界；
- [ ] 明确 `cover_asset` MVP；
- [ ] 建立固定套件 registry 和版本；
- [ ] 建立运行时 schema validator；
- [ ] 加入小型图片 fixtures：纯色、渐变、棋盘格、模糊、高对比、损坏文件；
- [ ] 不接真实外部网络；
- [ ] `npm run verify`。

**完成标准：** 类型和套件语义明确，测试数据可重复，无功能入口。

### Phase 1：本地技术视觉画像

- [ ] 为现有 Python JSONL 协议增加明确版本的新命令；
- [ ] 用 Pillow/Numpy 实现确定性指标；
- [ ] 所有输出限制到 0～100 并有单元测试；
- [ ] 缺失、损坏、不支持文件生成明确状态；
- [ ] 不输出总审美分；
- [ ] `npm run verify`，另运行 Python fixtures 测试。

**完成标准：** 相同图片重复分析结果稳定；技术指标含义可解释；不会影响作品显示状态。

### Phase 2：结果表、缓存与现有任务系统整合

- [ ] 添加前向 SQLite migration；
- [ ] 添加 result repository 与 dimension repository；
- [ ] 扩展现有 analysis job kind，而非另造队列；
- [ ] 实现完整缓存 fingerprint；
- [ ] 支持范围预览、取消、部分失败、失败项重试；
- [ ] 测试从上一 schema 版本升级；
- [ ] `npm run verify`。

**完成标准：** 本地画像可以通过显式任务批量运行、恢复和缓存。

### Phase 3：密钥系统与 Fake Provider

- [ ] `safeStorage` secret store；
- [ ] preload 仅暴露最小配置/保存/删除/测试方法；
- [ ] 日志脱敏测试；
- [ ] 实现图片预处理和临时文件清理；
- [ ] 实现 `FakeVisionAdapter`；
- [ ] 用 fixture 打通外部任务全流程；
- [ ] `npm run verify`。

**完成标准：** 不访问真实 API 也能验证任务、结果、取消、安全和 UI 链路；密钥不会回到 Renderer。

### Phase 4：OpenAI 与 OpenAI-compatible

- [ ] OpenAI 原生 adapter；
- [ ] OpenAI-compatible adapter（覆盖 Qwen 类服务）；
- [ ] schema 校验与错误映射；
- [ ] timeout、Retry-After、有限重试；
- [ ] mock HTTP contract tests，不在自动测试调用付费 API；
- [ ] 可选的人工 smoke test；
- [ ] `npm run verify`。

**完成标准：** 单作品和小批量显式分析稳定，错误不会泄露密钥或卡死队列。

### Phase 5：Gemini 与 Anthropic

- [ ] 各自独立 adapter，禁止用一个“兼容请求”假定相同行为；
- [ ] 处理各自图片限制和内容拒绝；
- [ ] adapter contract tests；
- [ ] 记录 provider/model/prompt/preprocess fingerprint；
- [ ] `npm run verify`。

**完成标准：** 新供应商只影响 adapter，不改 job runner、DB 结构或通用 UI。

### Phase 6：正式 UI 与筛选

- [ ] 设置页；
- [ ] scope preview 与确认；
- [ ] 任务进度/取消/重试；
- [ ] 共享雷达组件；
- [ ] 动态亮点独立展示；
- [ ] 同一评价身份内的数值筛选；
- [ ] 键盘、空态、错误态和浅色主题检查；
- [ ] `npm run verify`。

**完成标准：** 用户永远知道何时会上传、上传给谁、结果来自何模型；无自动分析。

### Phase 7：另立语义搜索任务

- [ ] 只创建新任务文档与 ADR；
- [ ] 评估本地 CLIP/SigLIP 类 embedding、存储和索引；
- [ ] 不把评分文字临时冒充向量搜索；
- [ ] 本任务到此不继续实现。

---

## 11. 测试矩阵

至少覆盖：

### 本地分析

- 同一 fixture 多次结果相同；
- 指标范围为 0～100，不能出现 NaN/Infinity；
- 纯色、渐变、棋盘格、模糊、高对比的相对表现符合定义；
- 损坏、丢失、动画、不支持格式有稳定状态；
- 多页作品只处理封面且 UI 标明范围。

### Provider contract

- 成功 structured output；
- 维度缺失、多余、重名、越界、非数字；
- 非 JSON、过大响应、空响应；
- 401、403、408、429、5xx；
- Retry-After；
- 内容拒绝；
- 取消与 timeout；
- 重试后成功和重试耗尽。

### 安全

- API Key 不出现在日志、错误、IPC 返回、数据库和测试快照；
- Renderer 不能指定任意文件路径或任意授权头；
- endpoint 校验阻止危险 URL 和 HTTPS 降级；
- 临时图无原始 EXIF 且任务结束后被删除；
- 开启开发者工具也不能读取原始密钥。

### 数据与队列

- 从当前上一 schema 版本升级；
- 缓存命中与每个 fingerprint 字段的失效测试；
- 部分失败不回滚已成功项；
- 应用重启后未完成任务状态合理；
- 取消后无新的外部请求；
- 同一结果不会重复插入维度。

### 回归

- 画廊、灯箱、3D 画册、分类组合不因该功能改变；
- 下载完成后不自动分析；
- 收藏作品不被自动模糊；
- Explore 过滤规则与画廊画像完全隔离；
- `npm run verify` 全通过。

---

## 12. 明确禁止的实现方式

- 禁止把 API Key 明文存入数据库或 preferences；
- 禁止 Renderer 直接 `fetch` 外部视觉服务；
- 禁止 Renderer 传本地路径让主进程上传；
- 禁止启动、滚动、下载或打开灯箱时自动上传；
- 禁止用直方图/边缘指标输出“客观艺术总分”；
- 禁止把不同 provider/model/prompt 的分数直接混合排序；
- 禁止无状态的 `analyzeArtwork(id)` 一次性 IPC 绕过 job 系统；
- 禁止静默跳过失败，必须落稳定状态和原因；
- 禁止在没有 embedding 设计时宣称已支持语义搜索；
- 禁止为了接入雷达图顺带重写现有灯箱、3D 画册或主题系统；
- 禁止修改旧数据库 migration。

---

## 13. 验收门槛

整个任务只有在以下条件同时满足时才算完成：

1. 本地技术画像和外部主观解读在数据、UI、文案上清晰分离；
2. 用户可以在上传前看到范围和目的地并取消；
3. 密钥只在主进程解密使用，任何 Renderer API 都无法读回；
4. 外部分析复用显式任务队列，可取消、重试并保留部分成功；
5. 每条结果能追溯到 Asset、模型、套件、提示词和预处理版本；
6. 固定雷达可以筛选，动态亮点不伪装成可比雷达；
7. 分析结果不会改变作品可信、模糊、隐藏或删除状态；
8. 自动测试不调用真实付费 API；
9. 安装包中的 Python 运行时和新协议经过 smoke test；
10. `npm run verify` 通过，且无新的高优先级已知问题。

---

## 14. Gemini 执行交接语

可把下面内容直接交给 Gemini：

> 请严格按 `docs/plans/TASK_AI_RADAR_AND_EXTERNAL_VISION_IMPLEMENTATION_PLAN.md` 分阶段实施。先只完成 Phase 0，运行 `npm run verify`，汇报修改文件、测试结果、未决问题后停止，等待验收。不要提前写 Phase 1 之后的代码，不要改动既有灯箱、3D 画册、主题系统和作品信任逻辑。每个后续 Phase 也遵循“一阶段、一验证、一提交”的节奏。

---

## 15. 官方资料依据

- Electron `safeStorage`：<https://www.electronjs.org/docs/latest/api/safe-storage>
- Electron 安全清单：<https://www.electronjs.org/docs/latest/tutorial/security>
- OpenAI 图片输入：<https://platform.openai.com/docs/quickstart/make-your-first-api-request>
- OpenAI Structured Outputs：<https://developers.openai.com/api/docs/guides/structured-outputs>
- Gemini 图片理解：<https://ai.google.dev/gemini-api/docs/image-understanding>
- Gemini Structured Output：<https://ai.google.dev/gemini-api/docs/structured-output>
- Claude Vision：<https://platform.claude.com/docs/en/build-with-claude/vision>
- Claude Structured Outputs：<https://platform.claude.com/docs/en/build-with-claude/structured-outputs>
- Qwen OpenAI-compatible 多模态调用：<https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions>

