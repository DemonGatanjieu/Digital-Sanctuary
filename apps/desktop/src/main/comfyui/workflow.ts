import { createHash, randomUUID } from "node:crypto";
import type { ComfyWorkflowTemplate } from "@sanctuary/domain";

const MAX_WORKFLOW_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 1_000;
const MAX_DEPTH = 18;
const MAX_STRING_LENGTH = 100_000;
const POSITIVE_MARKER = "{{positive_prompt}}";
const NEGATIVE_MARKER = "{{negative_prompt}}";
const SOURCE_MARKER = "{{source_image}}";

interface WorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: unknown;
}

export interface PreparedWorkflow {
  workflow: Record<string, unknown>;
  summary: Record<string, unknown>;
}

export function parseComfyWorkflowTemplate(
  text: string,
  name: string,
  id: string = randomUUID(),
  createdAt: string = new Date().toISOString()
): ComfyWorkflowTemplate {
  if (Buffer.byteLength(text, "utf8") > MAX_WORKFLOW_BYTES) throw new Error("工作流文件超过 2 MiB 上限");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("工作流不是有效的 JSON");
  }
  const workflow = validateComfyWorkflow(parsed);
  const binding = inspectBindings(workflow);
  return {
    id: id.slice(0, 100),
    name: normalizeTemplateName(name),
    nodeCount: Object.keys(workflow).length,
    hasPositiveBinding: binding.hasPositive,
    hasNegativeBinding: binding.hasNegative,
    hasSourceImageBinding: binding.hasSource,
    createdAt,
    workflow
  };
}

export function validateComfyWorkflow(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error("ComfyUI API 工作流必须是节点对象");
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_NODES) throw new Error("工作流节点数量无效");
  for (const [nodeId, rawNode] of entries) {
    if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(nodeId)) throw new Error("工作流包含无效节点 ID");
    if (!isPlainObject(rawNode)) throw new Error(`节点 ${nodeId} 结构无效`);
    const node = rawNode as unknown as WorkflowNode;
    if (typeof node.class_type !== "string" || !node.class_type.trim() || node.class_type.length > 200) {
      throw new Error(`节点 ${nodeId} 缺少有效 class_type`);
    }
    if (!isPlainObject(node.inputs)) throw new Error(`节点 ${nodeId} 缺少 inputs`);
    validateJsonValue(node.inputs, 0);
  }
  return structuredClone(value);
}

export function prepareComfyWorkflow(
  template: ComfyWorkflowTemplate,
  input: { positivePrompt: string; negativePrompt: string; sourceImageName?: string }
): PreparedWorkflow {
  const workflow = validateComfyWorkflow(template.workflow);
  let positiveBound = false;
  let negativeBound = false;
  let sourceBound = false;

  replaceStrings(workflow, (value) => {
    let next = value;
    if (next.includes(POSITIVE_MARKER)) {
      next = next.replaceAll(POSITIVE_MARKER, input.positivePrompt);
      positiveBound = true;
    }
    if (next.includes(NEGATIVE_MARKER)) {
      next = next.replaceAll(NEGATIVE_MARKER, input.negativePrompt);
      negativeBound = true;
    }
    if (next.includes(SOURCE_MARKER)) {
      if (!input.sourceImageName) throw new Error("该工作流需要参考图，但当前没有可上传的图片");
      next = next.replaceAll(SOURCE_MARKER, input.sourceImageName);
      sourceBound = true;
    }
    return next;
  });

  const clipNodes = Object.entries(workflow)
    .filter((entry): entry is [string, WorkflowNode] => isWorkflowNode(entry[1]) && entry[1].class_type === "CLIPTextEncode")
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
  if (!positiveBound && clipNodes[0]?.[1].inputs && typeof clipNodes[0][1].inputs.text === "string") {
    clipNodes[0][1].inputs.text = input.positivePrompt;
    positiveBound = true;
  }
  if (!negativeBound && clipNodes[1]?.[1].inputs && typeof clipNodes[1][1].inputs.text === "string") {
    clipNodes[1][1].inputs.text = input.negativePrompt;
    negativeBound = true;
  }
  if (!sourceBound && input.sourceImageName) {
    const loadImageNode = Object.values(workflow).find(
      (node): node is WorkflowNode => isWorkflowNode(node) && node.class_type === "LoadImage" && typeof node.inputs.image === "string"
    );
    if (loadImageNode) {
      loadImageNode.inputs.image = input.sourceImageName;
      sourceBound = true;
    }
  }
  if (!positiveBound) throw new Error("工作流没有可识别的正向提示词节点；请使用 CLIPTextEncode 或 {{positive_prompt}} 占位符");

  const classTypes = [...new Set(Object.values(workflow)
    .filter(isWorkflowNode)
    .map((node) => node.class_type))].sort();
  const hash = createHash("sha256").update(JSON.stringify(workflow)).digest("hex");
  return {
    workflow,
    summary: {
      templateId: template.id,
      templateName: template.name,
      nodeCount: Object.keys(workflow).length,
      classTypes: classTypes.slice(0, 80),
      workflowHash: hash,
      positiveBound,
      negativeBound,
      sourceImageBound: sourceBound
    }
  };
}

function inspectBindings(workflow: Record<string, unknown>) {
  const serialized = JSON.stringify(workflow);
  const clipCount = Object.values(workflow).filter(
    (node) => isWorkflowNode(node) && node.class_type === "CLIPTextEncode" && typeof node.inputs.text === "string"
  ).length;
  return {
    hasPositive: serialized.includes(POSITIVE_MARKER) || clipCount >= 1,
    hasNegative: serialized.includes(NEGATIVE_MARKER) || clipCount >= 2,
    hasSource: serialized.includes(SOURCE_MARKER) || Object.values(workflow).some(
      (node) => isWorkflowNode(node) && node.class_type === "LoadImage" && typeof node.inputs.image === "string"
    )
  };
}

function validateJsonValue(value: unknown, depth: number): void {
  if (depth > MAX_DEPTH) throw new Error("工作流嵌套层级过深");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("工作流包含无效数字");
    return;
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) throw new Error("工作流字符串过长");
    if (/^(?:[a-zA-Z]:[\\/]|\\\\|file:)/i.test(value) || value.split(/[\\/]/).includes("..")) {
      throw new Error("工作流不得包含本机绝对路径或上级目录跳转");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error("工作流数组过大");
    for (const item of value) validateJsonValue(item, depth + 1);
    return;
  }
  if (!isPlainObject(value)) throw new Error("工作流包含不支持的数据类型");
  const entries = Object.entries(value);
  if (entries.length > 10_000) throw new Error("工作流对象过大");
  for (const [key, item] of entries) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") throw new Error("工作流包含危险键名");
    validateJsonValue(item, depth + 1);
  }
}

function replaceStrings(value: unknown, replacer: (value: string) => string): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (typeof value[index] === "string") value[index] = replacer(value[index]);
      else replaceStrings(value[index], replacer);
    }
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") value[key] = replacer(item);
    else replaceStrings(item, replacer);
  }
}

function isWorkflowNode(value: unknown): value is WorkflowNode {
  return isPlainObject(value) && typeof value.class_type === "string" && isPlainObject(value.inputs);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeTemplateName(value: string): string {
  const normalized = value.trim().replace(/\.json$/i, "").slice(0, 80);
  if (!normalized) throw new Error("工作流模板名称不能为空");
  return normalized;
}
