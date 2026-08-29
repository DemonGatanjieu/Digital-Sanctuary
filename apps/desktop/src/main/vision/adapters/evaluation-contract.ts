import {
  validateAdaptiveHighlights,
  validateDimensionScores,
  type ValidationOutcome,
  type VisionDimensionScore,
  type VisionSuiteDefinition
} from "@sanctuary/domain";

export function createEvaluationPrompt(suite: VisionSuiteDefinition): string {
  if (suite.kind === "external_adaptive_highlights") {
    return `你是一位谨慎的视觉艺术评论者。先真正观察这张具体图片，再自行选择恰好六个最能解释这张作品特点的画面维度。
不要为了省事套用固定六维，也不要评价图片中看不到的事物。可从构图巧思、角色表演、叙事调度、线条节奏、材质塑造、色彩关系、光影、氛围或其他确实显著的特点中选择；作品不同，六个维度也应当可能不同。
每个分数表示作品在该自选维度上的完成度，范围 0 到 100。既然该维度是你主动选出的显著方面，就必须给出有区分度的真实分数，不得全部填 0，不得照抄字段说明或占位词。
只返回一个有效 JSON 对象。对象包含 dimensions 数组和 summary 字符串。dimensions 必须恰好六项；每项必须包含：
- key：唯一的英文 lowercase_snake_case 标识；
- label：原创、自然、简短的中文维度名；
- score：0 到 100 的数字；
- reason：简短中文理由，必须点出这张图中可见的具体证据。
summary 是一句简洁中文总评。不要输出 Markdown、前后解释、示例值或模板占位词。`;
  }
  return `你是一位谨慎的视觉艺术评论者。只根据图片中可见的证据，按照“${suite.name}”完成主观评价。
只返回一个有效 JSON 对象，不要输出 Markdown 或模板占位词。对象包含 dimensions 数组和一句中文 summary。
dimensions 必须恰好包含下列维度，并保持这些 key；每项还须提供 0 到 100 的真实数字 score 和简短中文 explanation：
${suite.dimensions.map((dimension) => `- ${dimension.key}（${dimension.label}）：${dimension.description}`).join("\n")}
分数必须有区分度，理由必须联系这张图中可见的具体画面，不得照抄字段说明。`;
}

export function validateEvaluationDimensions(
  rawDimensions: unknown,
  suite: VisionSuiteDefinition
): ValidationOutcome<VisionDimensionScore[]> {
  if (suite.kind !== "external_adaptive_highlights") return validateDimensionScores(rawDimensions, suite);
  const adaptive = validateAdaptiveHighlights(rawDimensions, 6);
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
