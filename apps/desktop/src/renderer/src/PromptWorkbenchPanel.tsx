import { useEffect, useMemo, useState } from "react";
import {
  PROMPT_MODEL_PROFILES,
  applyPromptPreset,
  composePromptPreview,
  createPromptPreset,
  normalizePromptWorkspace,
  type PromptWorkspacePreferences,
  type TagDisposition,
  type VisionAssessment,
  type ComfyUiConfig,
  type ComfyUiJob,
  type ComfyWorkflowTemplateSummary
} from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import { Button } from "./Button";

const DISPOSITIONS: Array<{ value: TagDisposition; label: string; symbol: string }> = [
  { value: "favorite", label: "喜欢", symbol: "＋" },
  { value: "neutral", label: "中立", symbol: "·" },
  { value: "avoid", label: "避免", symbol: "－" }
];

export function PromptWorkbenchPanel({
  assessment,
  workId,
  pageIndex,
  onGenerated
}: {
  assessment: VisionAssessment;
  workId?: string | undefined;
  pageIndex: number;
  onGenerated?: (() => Promise<void> | void) | undefined;
}) {
  const [workspace, setWorkspace] = useState<PromptWorkspacePreferences>(() => normalizePromptWorkspace(null));
  const [negativeInput, setNegativeInput] = useState("");
  const [presetName, setPresetName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [comfyConfig, setComfyConfig] = useState<ComfyUiConfig | null>(null);
  const [comfyTemplates, setComfyTemplates] = useState<ComfyWorkflowTemplateSummary[]>([]);
  const [comfyJobs, setComfyJobs] = useState<ComfyUiJob[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void window.sanctuary.getPromptWorkspace(assessment.engine, assessment.engineVersion)
      .then((value) => {
        if (!active) return;
        setWorkspace(value);
        setNegativeInput(value.negativeLibrary.join("\n"));
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason, "提示词偏好读取失败"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [assessment.engine, assessment.engineVersion]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.sanctuary.getComfyUiConfig(),
      window.sanctuary.listComfyUiTemplates(),
      window.sanctuary.listComfyUiJobs()
    ]).then(([config, templates, jobs]) => {
      if (!active) return;
      setComfyConfig(config);
      setComfyTemplates(templates);
      setComfyJobs(jobs);
      setSelectedTemplateId((current) => current || templates[0]?.id || "");
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!comfyJobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const timer = window.setInterval(() => {
      void window.sanctuary.listComfyUiJobs().then((jobs) => {
        setComfyJobs((previous) => {
          const previousCompleted = new Set(previous.filter((job) => job.status === "completed").map((job) => job.id));
          if (jobs.some((job) => job.status === "completed" && !previousCompleted.has(job.id))) {
            void onGenerated?.();
            setNotice("ComfyUI 结果已安全回收到本地画廊，并保存来源与工作流摘要");
          }
          return jobs;
        });
      }).catch(() => undefined);
    }, 1_200);
    return () => window.clearInterval(timer);
  }, [comfyJobs, onGenerated]);

  const visibleTags = useMemo(() => Object.entries(assessment.labels)
    .filter(([, confidence]) => confidence >= 0.2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 48), [assessment.labels]);
  const preview = useMemo(
    () => composePromptPreview(assessment.labels, workspace, 0.2),
    [assessment.labels, workspace]
  );

  async function persist(next: PromptWorkspacePreferences, successMessage = "") {
    setSaving(true);
    setError("");
    try {
      const saved = await window.sanctuary.savePromptWorkspace(
        assessment.engine,
        assessment.engineVersion,
        next
      );
      setWorkspace(saved);
      setNegativeInput(saved.negativeLibrary.join("\n"));
      if (successMessage) setNotice(successMessage);
    } catch (reason) {
      setError(messageOf(reason, "提示词偏好保存失败"));
    } finally {
      setSaving(false);
    }
  }

  function setDisposition(tag: string, disposition: TagDisposition) {
    const dispositions = { ...workspace.dispositions };
    if (disposition === "neutral") delete dispositions[tag];
    else dispositions[tag] = disposition;
    void persist({ ...workspace, dispositions });
  }

  function saveNegativeLibrary() {
    const negativeLibrary = [...new Set(negativeInput
      .split(/[\n,，]+/)
      .map((item) => item.trim())
      .filter(Boolean))];
    void persist({ ...workspace, negativeLibrary }, "负向提示词库已保存在本机");
  }

  function savePreset() {
    if (!presetName.trim()) return;
    try {
      const preset = createPromptPreset(presetName, workspace);
      void persist({ ...workspace, presets: [preset, ...workspace.presets].slice(0, 30) }, `已保存预设“${preset.name}”`);
      setPresetName("");
    } catch (reason) {
      setError(messageOf(reason, "预设保存失败"));
    }
  }

  async function copy(text: string, label: string) {
    if (!text) return;
    try {
      await window.sanctuary.copyPromptText(text);
      setNotice(`${label}已复制`);
    } catch (reason) {
      setError(messageOf(reason, "复制失败"));
    }
  }

  async function sendToComfyUi() {
    if (!workId || !selectedTemplateId) return;
    setSending(true);
    setError("");
    try {
      const job = await window.sanctuary.startComfyUiJob({
        workId,
        pageIndex,
        templateId: selectedTemplateId,
        positivePrompt: preview.positivePrompt,
        negativePrompt: preview.negativePrompt
      });
      setComfyJobs((current) => [job, ...current]);
      setNotice("任务已进入本地 ComfyUI 串行队列；可以继续浏览，结果完成后会自动加入画廊");
    } catch (reason) {
      setError(messageOf(reason, "发送到 ComfyUI 失败"));
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="prompt-workbench-loading">正在读取当前模型的标签偏好…</div>;

  return (
    <section className="prompt-workbench" aria-label="提示词调音台">
      <header className="prompt-workbench-heading">
        <div>
          <p className="eyebrow">PROMPT BRIDGE</p>
          <h4>提示词调音台</h4>
          <span>只保存你的明确选择；不会拿收藏或浏览行为偷偷训练。</span>
        </div>
        <label>
          <span>生成模型语法</span>
          <select
            value={workspace.modelProfile}
            disabled={saving}
            onChange={(event) => void persist({ ...workspace, modelProfile: event.target.value as PromptWorkspacePreferences["modelProfile"] })}
          >
            {PROMPT_MODEL_PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
        </label>
      </header>

      {notice && <AppNotice tone="success" onDismiss={() => setNotice("")}>{notice}</AppNotice>}
      {error && <AppNotice tone="error" onDismiss={() => setError("")}>{error}</AppNotice>}

      <div className="prompt-disposition-legend" aria-hidden="true">
        <span className="favorite">＋ 喜欢：优先放进正向</span>
        <span>· 中立：按模型置信度保留</span>
        <span className="avoid">－ 避免：移入负向</span>
      </div>
      <div className="prompt-tag-tuner">
        {visibleTags.map(([tag, confidence]) => {
          const current = workspace.dispositions[tag] ?? "neutral";
          return (
            <article key={tag} className={`prompt-tuner-tag ${current}`}>
              <div><code>{tag}</code><small>{Math.round(confidence * 100)}%</small></div>
              <div className="prompt-tristate" role="group" aria-label={`${tag}偏好`}>
                {DISPOSITIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={current === option.value ? "active" : ""}
                    aria-pressed={current === option.value}
                    title={option.label}
                    disabled={saving}
                    onClick={() => setDisposition(tag, option.value)}
                  >
                    {option.symbol}<span>{option.label}</span>
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <div className="prompt-library-row">
        <label>
          <strong>个人负向提示词库</strong>
          <small>每行或逗号分隔；会附加到所有本模型预览的负向提示词。</small>
          <textarea
            value={negativeInput}
            rows={3}
            maxLength={8_000}
            placeholder="例如：watermark, low quality"
            onChange={(event) => setNegativeInput(event.target.value)}
          />
        </label>
        <Button size="small" disabled={saving} onClick={saveNegativeLibrary}>保存负向词库</Button>
      </div>

      <div className="prompt-preview-grid">
        <PromptOutput label="原始 WD 标签" value={preview.rawTags} onCopy={() => void copy(preview.rawTags, "原始标签")} />
        <PromptOutput label="正向提示词" value={preview.positivePrompt} onCopy={() => void copy(preview.positivePrompt, "正向提示词")} />
        <PromptOutput label="负向提示词" value={preview.negativePrompt} onCopy={() => void copy(preview.negativePrompt, "负向提示词")} />
      </div>

      <div className="prompt-preset-row">
        <input
          value={presetName}
          maxLength={80}
          placeholder="给当前调音方案起个名字"
          onChange={(event) => setPresetName(event.target.value)}
        />
        <Button size="small" disabled={!presetName.trim() || saving} onClick={savePreset}>保存本地预设</Button>
        {workspace.presets.length > 0 && (
          <select
            defaultValue=""
            aria-label="应用提示词预设"
            onChange={(event) => {
              const preset = workspace.presets.find((item) => item.id === event.target.value);
              if (preset) void persist(applyPromptPreset(workspace, preset), `已应用预设“${preset.name}”`);
              event.currentTarget.value = "";
            }}
          >
            <option value="" disabled>应用已有预设…</option>
            {workspace.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
        )}
      </div>
      {workspace.presets.length > 0 && (
        <div className="prompt-preset-list" aria-label="本地提示词预设">
          {workspace.presets.map((preset) => (
            <span key={preset.id}>
              <button type="button" onClick={() => void persist(applyPromptPreset(workspace, preset), `已应用预设“${preset.name}”`)}>{preset.name}</button>
              <button
                type="button"
                aria-label={`删除预设 ${preset.name}`}
                title="删除预设"
                onClick={() => void persist({ ...workspace, presets: workspace.presets.filter((item) => item.id !== preset.id) }, `已删除预设“${preset.name}”`)}
              >×</button>
            </span>
          ))}
        </div>
      )}

      <div className="comfy-send-panel">
        <div>
          <strong>送往本地 ComfyUI</strong>
          <small>{!workId
            ? "探索中的远程图片不能直接发送；请先明确下载到本地画廊。"
            : !comfyConfig?.enabled
              ? "桥接尚未启用，请先到设置中开启。"
              : comfyTemplates.length === 0
                ? "请先在设置中导入 ComfyUI API 工作流 JSON。"
                : "只发送当前本地页、这份正负提示词和你选择的工作流。"}</small>
        </div>
        {workId && comfyConfig?.enabled && comfyTemplates.length > 0 && (
          <div className="comfy-send-actions">
            <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
              {comfyTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            <Button variant="primary" busy={sending} busyLabel="正在入队…" disabled={!preview.positivePrompt} onClick={() => void sendToComfyUi()}>
              显式发送当前页
            </Button>
          </div>
        )}
        {comfyJobs.slice(0, 3).map((job) => (
          <div key={job.id} className={`comfy-inline-job ${job.status}`}>
            <span>{job.templateName} · {comfyJobLabel(job.status)}</span>
            {job.error && <small>{job.error}</small>}
            {(job.status === "queued" || job.status === "running") && (
              <button type="button" onClick={() => void window.sanctuary.cancelComfyUiJob(job.id).then(() => window.sanctuary.listComfyUiJobs()).then(setComfyJobs)}>取消等待</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function PromptOutput({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <article>
      <header><strong>{label}</strong><button type="button" onClick={onCopy} disabled={!value}>复制</button></header>
      <p>{value || "当前没有可输出的内容"}</p>
    </article>
  );
}

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "") : fallback;
}

function comfyJobLabel(status: ComfyUiJob["status"]): string {
  return { queued: "等待中", running: "生成中", completed: "已加入画廊", failed: "失败", cancelled: "已取消" }[status];
}
