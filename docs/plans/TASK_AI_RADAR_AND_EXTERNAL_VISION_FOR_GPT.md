# 后端工程任务书：AI 多维视觉雷达图评估系统与外接大模型 Vision API 服务

> **面向执行者**：GPT / 后端工程 Agent
> **任务目标**：为 Digital Sanctuary 实现一套不依赖第三方平台标签、完全基于画作视觉属性的“AI 多维属性雷达图评测系统”，以及支持外接主流多模态大模型（OpenAI GPT-4o / Claude / Gemini / Qwen-VL 等）的云端视觉分析与语义搜图服务；内建完善的格式校验、敏感/不支持图片静默跳过与降级容错机制。

---

## 1. 背景与核心设计理念

### 1.1 为什么放弃强制绑定 P 站官方 Tag？
- **数据异构与缺失**：P 站作者填写的 Tag 差异极大（主观标签、缩写、网络梗、角色名与风格混杂），且用户导入的本地画作无法获取此类标签。
- **纯粹视觉维度评估**：通过视觉模型对画面特征直接打分生成六边形雷达图，保证全库所有来源画作（Pixiv、Twitter、本地导入）拥有统一、客观、可横向对比的评分基准。

### 1.2 双层混合 AI 架构（Dual-Tier Vision Pipeline）
```
                       +----------------------------------------+
                       |              画作输入 (Artwork)        |
                       +----------------------------------------+
                                           |
                   +-----------------------+-----------------------+
                   |                                               |
        [Tier 1: 本地离线引擎]                           [Tier 2: 外接云端 Vision API]
   (Local Feature / ONNX Evaluator)                (OpenAI / Claude / Gemini / 自定义 API)
                   |                                               |
     - 极速生成 6 维雷达图评分                       - 深度画面解读、风格流派识别
     - 零网络依赖、100% 隐私安全                     - 跨模态自然语言搜索向量
     - 保证全库 100% 画作可覆盖                      - 支持配置开关、Token 预算控制
                   |                                               |
                   +-----------------------+-----------------------+
                                           |
                       +----------------------------------------+
                       |  异常检测与跳过决策 (Skip & Fallback)   |
                       |  - 超大图 / 动图 / 敏感拦截 / 不支持格式 |
                       |  - 自动静默跳过并标记原因，降级至本地评分 |
                       +----------------------------------------+
                                           |
                       +----------------------------------------+
                       |   数据库持久化 & IPC 上报渲染层展示     |
                       +----------------------------------------+
```

---

## 2. 核心数据结构与协议规范 (`packages/domain` & `packages/protocol`)

### 2.1 多维雷达图属性评分规范 (`ArtworkRadarScore`)

```typescript
export interface ArtworkRadarScore {
  /** 色彩丰富度 (0-100)：色相多样性、对比色调和度与饱和度动态范围 */
  colorRichness: number;
  /** 构图张力 (0-100)：黄金分割、透视景深、视线引导与主体平衡感 */
  composition: number;
  /** 细节刻画 (0-100)：线条精细度、笔触层次与微观纹理丰富度 */
  detailFidelity: number;
  /** 光影氛围 (0-100)：明暗对比、体积光/全局光照质感与环境氛围深度 */
  lightAtmosphere: number;
  /** 情感表现 (0-100)：角色神态张力、场景叙事性与视觉冲击力 */
  expression: number;
  /** 风格特异性 (0-100)：艺术辨识度、笔法个性与风格化程度 */
  styleDistinctiveness: number;
  /** 综合加权总评 (0-100) */
  overallScore: number;
  /** 评估方式："local" | "cloud_ai" | "hybrid" */
  evalMethod: "local" | "cloud_ai" | "hybrid";
  /** 评估完成时间戳 */
  evaluatedAt: string;
}
```

### 2.2 外接多模态 Vision API 配置与结果模型

```typescript
export type ExternalVisionProvider = "openai" | "anthropic" | "gemini" | "custom_openai_compatible";

export interface ExternalVisionConfig {
  enabled: boolean;
  provider: ExternalVisionProvider;
  endpoint?: string;
  apiKey: string;
  modelName: string;
  maxTokens?: number;
  temperature?: number;
  /** 超时时间 (毫秒)，默认 15000 */
  timeoutMs: number;
  /** 并发请求限制，默认 2 */
  maxConcurrency: number;
  /** 跳过大文件大小阈值 (MB)，默认 15MB */
  skipSizeThresholdMb: number;
}

export type VisionAnalysisStatus = "success" | "unsupported" | "rate_limited" | "error" | "skipped";

export interface ExternalVisionAnalysisResult {
  artworkId: string;
  status: VisionAnalysisStatus;
  radarScore?: ArtworkRadarScore;
  /** AI 生成的画面描述与赏析简评 */
  critiqueText?: string;
  /** AI 识别的艺术流派/视觉关键词 */
  detectedTags?: string[];
  /** 跳过或失败的原因说明（如 "图片超过 15MB，已跳过云端分析"、"模型不支持动图格式"） */
  skipReason?: string;
  providerUsed?: string;
  analyzedAt: string;
}
```

---

## 3. 核心后端模块实现路径

### 3.1 本地离线评分器 (`services/vision/src/local-radar-evaluator.ts`)
- **实现机制**：利用轻量图像处理分析色彩直方图熵（Color Entropy）、边缘拉普拉斯梯度（Detail/Sobel Filter）、明暗动态范围与主频分析，毫秒级快速输出确定性 `ArtworkRadarScore`。
- **作用**：确保在没有配置 API Key 或网络离线时，所有画作依然具备即开即得的雷达图。

### 3.2 外接 Vision API 客户端适配器 (`apps/desktop/src/main/vision/external-vision-client.ts`)
- 支持标准 OpenAI Vision 接口（`gpt-4o`, `gpt-4o-mini`）、Claude Vision（`claude-3-5-sonnet`）及兼容接口。
- **前置不支持检测（Pre-flight Check）**：
  1. 动图格式（GIF / Ugoira / WebP 动图）：标记为 `unsupported`，原因 `"动态画作不支持云端单帧分析"`，直接降级。
  2. 超大文件（> 15MB）：自动压缩生成适量大小的中间预览图或跳过。
  3. API 错误（如触发安全审查 400、配额耗尽 429）：捕获并封装为 `status: "rate_limited" | "skipped"`，不中断应用主流程，不使任务队列崩溃。

### 3.3 数据库存储扩展 (`packages/database`)
- 在数据库中增加 `artwork_radar_scores` 与 `artwork_ai_analyses` 表，支持持久化存储与快速条件索引（例如：筛选“色彩丰富度 > 80”的画作）。

### 3.4 IPC 通道定义 (`packages/protocol`)
- `vision:evaluate-radar`: `(artworkId: string) => Promise<ArtworkRadarScore>`
- `vision:analyze-with-external-ai`: `(artworkId: string, force?: boolean) => Promise<ExternalVisionAnalysisResult>`
- `vision:get-external-config`: `() => Promise<ExternalVisionConfig>`
- `vision:save-external-config`: `(config: ExternalVisionConfig) => Promise<void>`
- `vision:test-external-connection`: `(config: ExternalVisionConfig) => Promise<{ success: boolean; latencyMs: number; message?: string }>`

---

## 4. 前端交互与视觉规范

1. **影院大图与画册雷达图展示**：
   - 在画作侧边信息面板或全屏影院中嵌入科技感六边形雷达图（SVG 绘制，带有主题色发光多边形光晕）。
2. **不支持/跳过提示状态胶囊**：
   - 若某张图片因超大或动图被跳过云端大模型分析，UI 显示温和的黄色徽章 `⚠️ 本地评估 (云端模型不支持动图)`，并在悬浮时给出说明，保障用户知情权。
3. **设置页“AI 视觉大模型配置”**：
   - 允许用户填入自己的 API Key、选择模型、自定义 Base URL，并有一键“测试连接”功能。

---

## 5. 验收标准

1. **单元测试与门禁**：
   - 覆盖本地雷达图算法的各项评分输出边界测试（0-100 区间收敛）。
   - 覆盖外接 Vision API 客户端在 200、400（内容过滤）、429（超频）、超时等场景下的优雅跳过测试。
2. **一键验证通过**：
   - `npm run verify` 严格 0 错误（`typecheck && test && build`）。
