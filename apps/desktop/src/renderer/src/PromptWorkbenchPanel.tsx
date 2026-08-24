import { useEffect, useMemo, useState } from "react";
import {
  PROMPT_MODEL_PROFILES,
  applyPromptPreset,
  composePromptPreview,
  createPromptPreset,
  defaultPromptTagRole,
  normalizePromptTag,
  normalizePromptWorkspace,
  type PromptTagRole,
  type PromptWorkspacePreferences,
  type VisionAssessment,
  type ComfyUiConfig,
  type ComfyUiJob,
  type ComfyWorkflowTemplateSummary
} from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import { Button } from "./Button";

const TAG_ROLES: Array<{ value: PromptTagRole; label: string; shortLabel: string }> = [
  { value: "positive", label: "放进正向提示词", shortLabel: "正向" },
  { value: "ignored", label: "本次不发送", shortLabel: "忽略" },
  { value: "negative", label: "移到负向提示词", shortLabel: "负向" }
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
  const [tagRoles, setTagRoles] = useState<Record<string, PromptTagRole>>({});
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
        if (active) setError(messageOf(reason, "提示词设置读取失败"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [assessment.engine, assessment.engineVersion]);

  useEffect(() => {
    setTagRoles({});
    setNotice("");
  }, [workId, pageIndex, assessment.engine, assessment.engineVersion]);

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
            setNotice("ComfyUI 结果已回收到本地画廊，并保存了来源和工作流摘要");
          }
          return jobs;
        });
      }).catch(() => undefined);
    }, 1_200);
    return () => window.clearInterval(timer);
  }, [comfyJobs, onGenerated]);

  const visibleTags = useMemo(() => Object.entries(assessment.labels)
    .filter(([, confidence]) => confidence >= 0.2)
    .map(([tag, confidence]) => [normalizePromptTag(tag), confidence] as const)
    .filter(([tag]) => Boolean(tag))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 60), [assessment.labels]);
  const preview = useMemo(
    () => composePromptPreview(assessment.labels, workspace, 0.2, tagRoles),
    [assessment.labels, workspace, tagRoles]
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
      setError(messageOf(reason, "提示词设置保存失败"));
    } finally {
      setSaving(false);
    }
  }

  function setRole(tag: string, role: PromptTagRole) {
    setTagRoles((current) => ({ ...current, [tag]: role }));
  }

  function saveNegativeLibrary() {
    const negativeLibrary = [...new Set(negativeInput
      .split(/[\n,，]+/)
      .map((item) => item.trim())
      .filter(Boolean))];
    void persist({ ...workspace, negativeLibrary }, "常用负向词已保存在本机");
  }

  function savePreset() {
    if (!presetName.trim()) return;
    try {
      const preset = createPromptPreset(presetName, workspace);
      void persist({ ...workspace, presets: [preset, ...workspace.presets].slice(0, 30) }, `已保存格式预设“${preset.name}”`);
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
      setNotice("任务已进入本地 ComfyUI 队列；完成后会自动加入画廊");
    } catch (reason) {
      setError(messageOf(reason, "发送到 ComfyUI 失败"));
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="prompt-workbench-loading">正在读取本地提示词设置…</div>;

  return (
    <section className="prompt-workbench" aria-label="生成提示词整理">
      <header className="prompt-workbench-heading">
        <div>
          <p className="eyebrow">PROMPT DRAFT</p>
          <h4>整理这张图片的生成提示词</h4>
          <span>这里只整理当前图片，不会把标签积累成长期模型偏好。</span>
        </div>
        <span className="prompt-local-badge">本图临时选择</span>
      </header>

      {notice && <AppNotice tone="success" onDismiss={() => setNotice("")}>{notice}</AppNotice>}
      {error && <AppNotice tone="error" onDismiss={() => setError("")}>{error}</AppNotice>}

      <div className="prompt-confidence-note">
        <span aria-hidden="true">%</span>
        <div>
          <strong>百分比只是“识别把握”</strong>
          <small>它只帮助筛选候选元素，不会直接变成 ComfyUI 的提示词权重。</small>
        </div>
      </div>

      <div className="prompt-role-summary" aria-label="本次提示词分类摘要">
        <span className="positive"><strong>{preview.positiveTags.length}</strong> 放进正向</span>
        <span className="ignored"><strong>{preview.ignoredTags.length}</strong> 本次忽略</span>
        <span className="negative"><strong>{preview.negativeTags.length}</strong> 移到负向</span>
        <button type="button" onClick={() => setTagRoles({})} disabled={Object.keys(tagRoles).length === 0}>恢复默认</button>
      </div>

      <div className="prompt-tag-tuner">
        {visibleTags.map(([tag, confidence]) => {
          const current = tagRoles[tag] ?? defaultPromptTagRole(confidence);
          return (
            <article key={tag} className={`prompt-tuner-tag ${current}`}>
              <div>
                <code title={tag}>{tag}</code>
                <small>{Math.round(confidence * 100)}% 识别把握</small>
              </div>
              <div className="prompt-tristate" role="group" aria-label={`${tag}本次发送方式`}>
                {TAG_ROLES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={current === option.value ? "active" : ""}
                    aria-pressed={current === option.value}
                    title={option.label}
                    onClick={() => setRole(tag, option.value)}
                  >
                    {option.shortLabel}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <div className="prompt-preview-grid">
        <PromptOutput tone="positive" label={`正向提示词 · ${preview.positiveTags.length} 项`} value={preview.positivePrompt} onCopy={() => void copy(preview.positivePrompt, "正向提示词")} />
        <PromptOutput tone="negative" label={`负向提示词 · ${preview.negativeTags.length + workspace.negativeLibrary.length} 项`} value={preview.negativePrompt} onCopy={() => void copy(preview.negativePrompt, "负向提示词")} />
        <PromptOutput tone="raw" label="原始识别标签（核对用）" value={preview.rawTags} onCopy={() => void copy(preview.rawTags, "原始标签")} />
      </div>

      <details className="prompt-advanced-settings">
        <summary>
          <span><strong>输出格式与常用负向词</strong><small>可选设置，会保存在当前本地视觉模型下</small></span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="prompt-advanced-body">
          <label className="prompt-profile-field">
            <span>输出文字格式</span>
            <select
              value={workspace.modelProfile}
              disabled={saving}
              onChange={(event) => void persist({ ...workspace, modelProfile: event.target.value as PromptWorkspacePreferences["modelProfile"] })}
            >
              {PROMPT_MODEL_PROFILES.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
            <small>{PROMPT_MODEL_PROFILES.find((profile) => profile.id === workspace.modelProfile)?.description}</small>
          </label>

          <div className="prompt-library-row">
            <label>
              <strong>常用负向词</strong>
              <small>这里只保存通用词，例如 watermark、low quality；不会保存本图元素选择。</small>
              <textarea
                value={negativeInput}
                rows={3}
                maxLength={8_000}
                placeholder="例如：watermark, low quality"
                onChange={(event) => setNegativeInput(event.target.value)}
              />
            </label>
            <Button size="small" disabled={saving} onClick={saveNegativeLibrary}>保存常用负向词</Button>
          </div>

          <div className="prompt-preset-row">
            <input
              value={presetName}
              maxLength={80}
              placeholder="保存当前输出格式和常用负向词"
              onChange={(event) => setPresetName(event.target.value)}
            />
            <Button size="small" disabled={!presetName.trim() || saving} onClick={savePreset}>保存格式预设</Button>
            {workspace.presets.length > 0 && (
              <select
                defaultValue=""
                aria-label="应用提示词格式预设"
                onChange={(event) => {
                  const preset = workspace.presets.find((item) => item.id === event.target.value);
                  if (preset) void persist(applyPromptPreset(workspace, preset), `已应用格式预设“${preset.name}”`);
                  event.currentTarget.value = "";
                }}
              >
                <option value="" disabled>应用已有格式预设…</option>
                {workspace.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
            )}
          </div>
          {workspace.presets.length > 0 && (
            <div className="prompt-preset-list" aria-label="本地提示词格式预设">
              {workspace.presets.map((preset) => (
                <span key={preset.id}>
                  <button type="button" onClick={() => void persist(applyPromptPreset(workspace, preset), `已应用格式预设“${preset.name}”`)}>{preset.name}</button>
                  <button
                    type="button"
                    aria-label={`删除格式预设 ${preset.name}`}
                    title="删除预设"
                    onClick={() => void persist({ ...workspace, presets: workspace.presets.filter((item) => item.id !== preset.id) }, `已删除格式预设“${preset.name}”`)}
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </details>

      <div className="comfy-send-panel">
        <div>
          <strong>使用当前本地后端快速生成</strong>
          <small>{!workId
            ? "探索中的远程图片不能直接发送；请先明确下载到本地画廊。"
            : !comfyConfig?.enabled
              ? "ComfyUI 桥接尚未启用，请先到设置中开启。"
              : comfyTemplates.length === 0
                ? "请先在设置中导入一个 ComfyUI API 工作流。"
                : "会发送当前本地页、上面的正负提示词和你选择的工作流。"}</small>
        </div>
        {workId && comfyConfig?.enabled && comfyTemplates.length > 0 && (
          <div className="comfy-send-actions">
            <label>
              <span>工作流</span>
              <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                {comfyTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
            <Button variant="primary" busy={sending} busyLabel="正在发送…" disabled={!preview.positivePrompt} onClick={() => void sendToComfyUi()}>
              发送当前图片
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

function PromptOutput({ label, value, onCopy, tone }: { label: string; value: string; onCopy: () => void; tone: "positive" | "negative" | "raw" }) {
  return (
    <article className={tone}>
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
