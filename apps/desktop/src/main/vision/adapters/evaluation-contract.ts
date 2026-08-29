import {
  validateAdaptiveHighlights,
  validateDimensionScores,
  type ValidationOutcome,
  type VisionDimensionScore,
  type VisionImageReading,
  type VisionSuiteDefinition
} from "@sanctuary/domain";

export const EVALUATION_PROMPT_VERSION = "image_reading_v2";

export function createEvaluationPrompt(suite: VisionSuiteDefinition): string {
  if (suite.kind === "external_adaptive_highlights") {
    return `你是一位谨慎、具体而诚实的视觉艺术评论者。先真正观察这张具体图片，再自行选择恰好六个最能解释这张作品特点的画面维度。
不要为了省事套用固定六维，也不要评价图片中看不到的事物。可从构图巧思、角色表演、叙事调度、线条节奏、材质塑造、色彩关系、光影、氛围或其他确实显著的特点中选择；作品不同，六个维度也应当可能不同。
每个分数表示作品在该自选维度上的完成度，范围 0 到 100：50 表示常见但成立，70 表示扎实，85 表示明显出色，95 以上只留给极少见的卓越表现。必须拉开真实差距，不要礼貌性地全部给高分，也不要全部填 0。
理由必须指出能在这张图里定位的对象、位置、颜色、动作或关系；禁止只写“构图优秀”“色彩和谐”“氛围感强”等换图也成立的套话。评价允许指出克制、不足或尚可加强之处，不要一味赞美。
先输出画面阅读，再输出评分。只返回一个有效 JSON 对象，包含 observation、visual_focus、interpretation、uncertainty、dimensions 和 summary：
- observation：两到四句客观观察，只写图片里直接可见的主体、位置、颜色、动作与关系，不写身份猜测或故事结论；
- visual_focus：一到六个简短中文字符串，按重要性列出主要视觉落点；
- interpretation：一到三句主观解读，可以谈氛围、叙事或设计意图，但必须使用“可能”“仿佛”“给人……感觉”等措辞与事实区分；
- uncertainty：零到四个简短中文字符串，列出仅凭当前图片无法确认的身份、背景或情节；没有则返回空数组。
dimensions 必须恰好六项；每项必须包含：
- key：唯一的英文 lowercase_snake_case 标识；
- label：原创、自然、简短的中文维度名；
- score：0 到 100 的数字；
- reason：简短中文理由，必须点出这张图中可见的具体证据。
六项的 key 请依次固定写成 axis_1、axis_2、axis_3、axis_4、axis_5、axis_6；真正面向用户的中文维度名写在 label 中。
summary 用两到三句中文概括这张图最独特的视觉选择、最有效之处，以及一个真实的限制或可提升点。不要输出 Markdown、前后解释、示例值或模板占位词。`;
  }
  return `你是一位谨慎的视觉艺术评论者。只根据图片中可见的证据，按照“${suite.name}”完成主观评价。
评分标尺：50 表示常见但成立，70 表示扎实，85 表示明显出色，95 以上只留给极少见的卓越表现。不要把全部维度礼貌性地堆在高分区间。
每项理由必须指向这张图中可定位的具体对象、位置、颜色、动作或关系，不得使用换一张图也成立的套话；允许诚实指出限制或可提升点。
先输出画面阅读，再输出评分。只返回一个有效 JSON 对象，不要输出 Markdown 或模板占位词。对象包含：
- observation：两到四句客观观察，只写可见事实，不猜角色身份、出处或故事；
- visual_focus：一到六个主要视觉落点组成的中文字符串数组；
- interpretation：一到三句主观解读，明确使用“可能”“仿佛”或“给人……感觉”等推测措辞；
- uncertainty：零到四个无法仅凭图片确认的事项组成的中文字符串数组；
- dimensions 数组和两到三句中文 summary。
dimensions 必须恰好包含下列维度，并保持这些 key；每项还须提供 0 到 100 的真实数字 score 和简短中文 explanation：
${suite.dimensions.map((dimension) => `- ${dimension.key}（${dimension.label}）：${dimension.description}`).join("\n")}
分数必须有区分度，理由必须联系这张图中可见的具体画面，不得照抄字段说明。`;
}

export function normalizeImageReading(raw: unknown): VisionImageReading | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as Record<string, unknown>;
  const observation = boundedText(candidate.observation, 700);
  if (!observation) return undefined;
  const interpretation = boundedText(candidate.interpretation, 500);
  const visualFocus = boundedTextArray(candidate.visual_focus ?? candidate.visualFocus, 6, 80);
  const uncertainties = boundedTextArray(candidate.uncertainty ?? candidate.uncertainties, 4, 120);
  return {
    observation,
    ...(interpretation ? { interpretation } : {}),
    visualFocus,
    uncertainties
  };
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function boundedTextArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

export function validateEvaluationDimensions(
  rawDimensions: unknown,
  suite: VisionSuiteDefinition
): ValidationOutcome<VisionDimensionScore[]> {
  if (suite.kind !== "external_adaptive_highlights") return validateDimensionScores(rawDimensions, suite);
  const adaptive = validateAdaptiveHighlights(repairAdaptiveModelDimensions(rawDimensions), 6);
  if (!adaptive.valid || !adaptive.normalized) return { valid: false, errors: adaptive.errors ?? ["Invalid adaptive dimensions"] };
  return {
    valid: true,
    normalized: adaptive.normalized.map((highlight) => ({
      key: highlight.key,
      label: highlight.label,
      score: highlight.score,
      ...(highlight.reason ? { explanation: highlight.reason } : {})
    }))
  };
}

/**
 * Small local vision-language models sometimes put the Chinese display label in
 * `key`, use `explanation` instead of `reason`, or return one surplus axis. Those
 * are transport-shape mistakes rather than invalid visual evidence, so repair
 * them before applying the strict domain validator. Scores, labels, evidence,
 * uniqueness and the final six-axis contract remain validated afterwards.
 */
export function repairAdaptiveModelDimensions(rawDimensions: unknown): unknown {
  if (!Array.isArray(rawDimensions)) return rawDimensions;

  const usedKeys = new Set<string>();
  const repaired = rawDimensions.map((item, index) => {
    if (!item || typeof item !== "object") return item;
    const candidate = item as Record<string, unknown>;
    const originalKey = typeof candidate.key === "string" ? candidate.key.trim() : "";
    const validOriginalKey = /^[a-z0-9_]{1,64}$/.test(originalKey) && !usedKeys.has(originalKey);
    const key = validOriginalKey
      ? originalKey
      : allocateAdaptiveKey(index, usedKeys);
    usedKeys.add(key);

    const label = typeof candidate.label === "string" && candidate.label.trim()
      ? candidate.label.trim()
      : originalKey && !/^[a-z0-9_]{1,64}$/.test(originalKey)
        ? originalKey
        : candidate.label;
    const reason = typeof candidate.reason === "string" && candidate.reason.trim()
      ? candidate.reason
      : candidate.explanation;

    return { ...candidate, key, label, reason };
  });

  if (repaired.length <= 6 || repaired.length > 10) return repaired;

  const ranked = repaired
    .map((item, index) => ({ item, index, score: scoreOf(item) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 6)
    .sort((left, right) => left.index - right.index);
  return ranked.map(({ item }) => item);
}

function allocateAdaptiveKey(index: number, usedKeys: ReadonlySet<string>): string {
  let suffix = index + 1;
  let key = `adaptive_axis_${suffix}`;
  while (usedKeys.has(key)) {
    suffix += 1;
    key = `adaptive_axis_${suffix}`;
  }
  return key;
}

function scoreOf(item: unknown): number {
  if (!item || typeof item !== "object") return Number.NEGATIVE_INFINITY;
  const score = (item as Record<string, unknown>).score;
  return typeof score === "number" && Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY;
}
