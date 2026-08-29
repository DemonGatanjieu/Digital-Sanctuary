export type VisionEvaluationKind =
  | "local_technical_profile"
  | "external_fixed_suite"
  | "external_adaptive_highlights";

export type VisionEvaluationStatus =
  | "success"
  | "unsupported"
  | "content_blocked"
  | "auth_error"
  | "rate_limited"
  | "quota_exhausted"
  | "timeout"
  | "network_error"
  | "invalid_response"
  | "cancelled"
  | "skipped";

export type VisionEvaluationScope = "cover_asset";

export interface VisionDimensionScore {
  key: string;
  label: string;
  score: number; // 0..100
  explanation?: string | undefined;
}

export interface VisionEvaluationResult {
  id: string;
  workId: string;
  assetId: string;
  scope: VisionEvaluationScope;
  kind: VisionEvaluationKind;
  suiteId: string;
  suiteVersion: number;
  status: VisionEvaluationStatus;
  reasonCode?: string | undefined;
  dimensions: VisionDimensionScore[];
  summary?: string | undefined;
  providerId?: string | undefined;
  modelId?: string | undefined;
  evaluatorVersion: string;
  promptVersion?: string | undefined;
  preprocessingFingerprint: string;
  assetVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface VisionEvaluationRequest {
  workId: string;
  suiteId: string;
  providerId?: ExternalVisionProviderId | undefined;
  force?: boolean | undefined;
}

export interface AdaptiveHighlight {
  key: string;
  label: string;
  score: number; // 0..100
  reason?: string | undefined;
}

export type ExternalVisionProviderId =
  | "openai"
  | "gemini"
  | "anthropic"
  | "openai_compatible";

export interface ExternalVisionPublicConfig {
  id: string;
  provider: ExternalVisionProviderId;
  model: string;
  endpoint?: string | undefined;
  hasApiKey: boolean;
  keyHint?: string | undefined;
  enabled: boolean;
  maxConcurrency: number;
  maxLongEdge: number;
}

export interface VisionSuiteDimensionDefinition {
  key: string;
  label: string;
  description: string;
  min: number; // 0
  max: number; // 100
}

export interface VisionSuiteDefinition {
  id: string;
  version: number;
  name: string;
  description: string;
  kind: VisionEvaluationKind;
  dimensions: VisionSuiteDimensionDefinition[];
}

export const TECHNICAL_VISUAL_SUITE_V1: VisionSuiteDefinition = {
  id: "technical_visual_v1",
  version: 1,
  name: "本地技术视觉画像",
  description: "由确定性图像统计特征计算，用于整理和比较视觉特征，不代表作品审美质量。",
  kind: "local_technical_profile",
  dimensions: [
    { key: "colorfulness", label: "色彩丰富度", description: "色相多样性与饱和度跨度", min: 0, max: 100 },
    { key: "tonal_range", label: "明暗跨度", description: "高光至阴影的直方图动态覆盖范围", min: 0, max: 100 },
    { key: "luminance_balance", label: "亮度均衡度", description: "全图整体光度分布的均衡程度", min: 0, max: 100 },
    { key: "edge_density", label: "边缘密度", description: "拉普拉斯/索贝尔高频轮廓线条密度", min: 0, max: 100 },
    { key: "sharpness_proxy", label: "清晰度代理值", description: "局部微对比度与高频聚焦度估值", min: 0, max: 100 },
    { key: "spatial_balance", label: "空间分布平衡", description: "图像四象限重心的对称与分散程度", min: 0, max: 100 }
  ]
};

export const FINE_ART_SUITE_V1: VisionSuiteDefinition = {
  id: "fine_art_v1",
  version: 1,
  name: "美术造诣主观解读",
  description: "由外部 AI 视觉模型给出的美术技法与画风解读，仅代表 AI 主观视角。",
  kind: "external_fixed_suite",
  dimensions: [
    { key: "composition", label: "构图结构", description: "黄金分割、景深透视与主体布局", min: 0, max: 100 },
    { key: "color_harmony", label: "色彩和谐", description: "色调搭配、对比调和与氛围渲染", min: 0, max: 100 },
    { key: "lighting", label: "光影表现", description: "明暗层次、体积光与环境光照质感", min: 0, max: 100 },
    { key: "visual_focus", label: "视觉焦点", description: "视线引导、主体突出与留白呼应", min: 0, max: 100 },
    { key: "atmosphere", label: "氛围渲染", description: "意境深度、情绪感染力与叙事感", min: 0, max: 100 },
    { key: "detail_control", label: "细节把控", description: "微观纹理、笔触层次与质感刻画", min: 0, max: 100 }
  ]
};

export const CHARACTER_PRESENCE_SUITE_V1: VisionSuiteDefinition = {
  id: "character_presence_v1",
  version: 1,
  name: "角色表现主观解读",
  description: "由外部 AI 视觉模型给出的二次元角色形体与神态解读，仅代表 AI 主观视角。",
  kind: "external_fixed_suite",
  dimensions: [
    { key: "expression", label: "神态传神度", description: "眼神视线、面部微表情与情绪张力", min: 0, max: 100 },
    { key: "pose_dynamism", label: "体态张力", description: "身姿透视、动态线条与肢体表现力", min: 0, max: 100 },
    { key: "costume_detail", label: "服饰刻画", description: "服装材质、褶皱细节与饰品设计", min: 0, max: 100 },
    { key: "focal_clarity", label: "主体辨识", description: "人物与背景分离度与视觉辨识度", min: 0, max: 100 },
    { key: "silhouette", label: "剪影结构", description: "外轮廓节奏感与形体可读性", min: 0, max: 100 },
    { key: "palette_harmony", label: "人设色调", description: "角色固有色与环境光的融合度", min: 0, max: 100 }
  ]
};

export const VISION_SUITE_REGISTRY: Record<string, VisionSuiteDefinition> = {
  [`${TECHNICAL_VISUAL_SUITE_V1.id}@v${TECHNICAL_VISUAL_SUITE_V1.version}`]: TECHNICAL_VISUAL_SUITE_V1,
  [`${FINE_ART_SUITE_V1.id}@v${FINE_ART_SUITE_V1.version}`]: FINE_ART_SUITE_V1,
  [`${CHARACTER_PRESENCE_SUITE_V1.id}@v${CHARACTER_PRESENCE_SUITE_V1.version}`]: CHARACTER_PRESENCE_SUITE_V1
};

export function getVisionSuite(suiteId: string, version = 1): VisionSuiteDefinition | null {
  return VISION_SUITE_REGISTRY[`${suiteId}@v${version}`] ?? null;
}

export function listVisionSuites(): VisionSuiteDefinition[] {
  return Object.values(VISION_SUITE_REGISTRY);
}

export interface ValidationOutcome<T> {
  valid: boolean;
  normalized?: T;
  errors?: string[];
}

export function validateDimensionScores(
  rawDimensions: unknown,
  suite: VisionSuiteDefinition
): ValidationOutcome<VisionDimensionScore[]> {
  if (!Array.isArray(rawDimensions)) {
    return { valid: false, errors: ["Dimensions must be an array"] };
  }

  const errors: string[] = [];
  const requiredKeys = new Set(suite.dimensions.map((d) => d.key));
  const dimensionDefsByKey = new Map(suite.dimensions.map((d) => [d.key, d]));
  const seenKeys = new Set<string>();
  const normalized: VisionDimensionScore[] = [];

  for (const item of rawDimensions) {
    if (!item || typeof item !== "object") {
      errors.push("Each dimension item must be an object");
      continue;
    }

    const candidate = item as Record<string, unknown>;
    const key = typeof candidate.key === "string" ? candidate.key.trim() : "";

    if (!key || !requiredKeys.has(key)) {
      // Ignore extra unexpected dimension keys or record error
      continue;
    }

    if (seenKeys.has(key)) {
      errors.push(`Duplicate dimension key: ${key}`);
      continue;
    }

    const rawScore = candidate.score;
    if (typeof rawScore !== "number" || !Number.isFinite(rawScore)) {
      errors.push(`Dimension ${key} score must be a finite number`);
      continue;
    }

    if (rawScore < 0 || rawScore > 100) {
      errors.push(`Dimension ${key} score must be between 0 and 100 (got ${rawScore})`);
      continue;
    }

    seenKeys.add(key);
    const def = dimensionDefsByKey.get(key)!;
    const explanation = typeof candidate.explanation === "string" && candidate.explanation.trim()
      ? candidate.explanation.trim().slice(0, 500)
      : undefined;

    normalized.push({
      key,
      label: def.label,
      score: Math.round(rawScore * 100) / 100,
      explanation
    });
  }

  // Check if all required keys are present
  for (const requiredKey of requiredKeys) {
    if (!seenKeys.has(requiredKey)) {
      errors.push(`Missing required dimension key: ${requiredKey}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Ensure deterministic ordering matching the suite definition
  const sorted = suite.dimensions.map((def) => normalized.find((n) => n.key === def.key)!);
  return { valid: true, normalized: sorted };
}

export function validateAdaptiveHighlights(
  rawHighlights: unknown
): ValidationOutcome<AdaptiveHighlight[]> {
  if (!Array.isArray(rawHighlights)) {
    return { valid: false, errors: ["Highlights must be an array"] };
  }

  const errors: string[] = [];
  const normalized: AdaptiveHighlight[] = [];
  const seenKeys = new Set<string>();

  for (const item of rawHighlights) {
    if (!item || typeof item !== "object") {
      errors.push("Each highlight item must be an object");
      continue;
    }
    const candidate = item as Record<string, unknown>;
    const key = typeof candidate.key === "string" ? candidate.key.trim() : "";
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
    const rawScore = candidate.score;

    if (!key || !/^[a-z0-9_]{1,64}$/.test(key)) {
      errors.push(`Highlight key must be 1-64 lowercase alphanumeric/underscore characters (got ${key})`);
      continue;
    }
    if (!label || label.length > 64) {
      errors.push(`Highlight label must be 1-64 characters (got ${label})`);
      continue;
    }
    if (typeof rawScore !== "number" || !Number.isFinite(rawScore) || rawScore < 0 || rawScore > 100) {
      errors.push(`Highlight ${key} score must be a finite number between 0 and 100`);
      continue;
    }
    if (seenKeys.has(key)) {
      errors.push(`Duplicate highlight key: ${key}`);
      continue;
    }

    seenKeys.add(key);
    const reason = typeof candidate.reason === "string" && candidate.reason.trim()
      ? candidate.reason.trim().slice(0, 300)
      : undefined;

    normalized.push({
      key,
      label,
      score: Math.round(rawScore * 100) / 100,
      reason
    });
  }

  if (normalized.length < 1 || normalized.length > 10) {
    errors.push(`Adaptive highlights count must be between 1 and 10 (got ${normalized.length})`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, normalized };
}

export function validateExternalVisionPublicConfig(
  rawConfig: unknown
): ValidationOutcome<ExternalVisionPublicConfig> {
  if (!rawConfig || typeof rawConfig !== "object") {
    return { valid: false, errors: ["External vision config must be an object"] };
  }

  const errors: string[] = [];
  const candidate = rawConfig as Record<string, unknown>;

  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : "default";
  const validProviders: ExternalVisionProviderId[] = ["openai", "gemini", "anthropic", "openai_compatible"];
  const provider = candidate.provider as ExternalVisionProviderId;
  if (!validProviders.includes(provider)) {
    errors.push(`Invalid vision provider: ${String(candidate.provider)}`);
  }

  const model = typeof candidate.model === "string" ? candidate.model.trim() : "";
  if (!model || model.length > 128) {
    errors.push("Model name must be a non-empty string up to 128 characters");
  }

  let endpoint: string | undefined = undefined;
  if (candidate.endpoint !== undefined && candidate.endpoint !== null && candidate.endpoint !== "") {
    if (typeof candidate.endpoint !== "string") {
      errors.push("Endpoint must be a string if provided");
    } else {
      try {
        const parsed = new URL(candidate.endpoint);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          errors.push("Endpoint must use https (or http for local debugging)");
        }
        if (parsed.username || parsed.password) {
          errors.push("Endpoint must not contain credentials");
        }
        endpoint = candidate.endpoint.trim();
      } catch {
        errors.push("Invalid endpoint URL format");
      }
    }
  }

  const hasApiKey = Boolean(candidate.hasApiKey);
  const keyHint = typeof candidate.keyHint === "string" ? candidate.keyHint.trim().slice(0, 32) : undefined;
  const enabled = Boolean(candidate.enabled);

  const maxConcurrency = typeof candidate.maxConcurrency === "number" && Number.isInteger(candidate.maxConcurrency) && candidate.maxConcurrency >= 1 && candidate.maxConcurrency <= 8
    ? candidate.maxConcurrency
    : 1;

  const maxLongEdge = typeof candidate.maxLongEdge === "number" && Number.isInteger(candidate.maxLongEdge) && candidate.maxLongEdge >= 512 && candidate.maxLongEdge <= 4096
    ? candidate.maxLongEdge
    : 1568;

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    normalized: {
      id,
      provider,
      model,
      endpoint,
      hasApiKey,
      keyHint,
      enabled,
      maxConcurrency,
      maxLongEdge
    }
  };
}
