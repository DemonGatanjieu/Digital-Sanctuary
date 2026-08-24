import { useEffect, useState } from "react";
import type { ComfyUiConfig, ComfyUiJob, ComfyWorkflowTemplateSummary } from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import { Button } from "./Button";

export function ComfyUiSettingsSection() {
  const [config, setConfig] = useState<ComfyUiConfig>({ enabled: false, baseUrl: "http://127.0.0.1:8188" });
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:8188");
  const [templates, setTemplates] = useState<ComfyWorkflowTemplateSummary[]>([]);
  const [jobs, setJobs] = useState<ComfyUiJob[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.sanctuary.getComfyUiConfig(),
      window.sanctuary.listComfyUiTemplates(),
      window.sanctuary.listComfyUiJobs()
    ]).then(([nextConfig, nextTemplates, nextJobs]) => {
      if (!active) return;
      setConfig(nextConfig);
      setEndpoint(nextConfig.baseUrl);
      setTemplates(nextTemplates);
      setJobs(nextJobs);
    }).catch((error: unknown) => {
      if (active) setNotice({ tone: "error", text: messageOf(error, "ComfyUI 配置读取失败") });
    });
    return () => { active = false; };
  }, []);

  async function save(nextEnabled = config.enabled) {
    setBusy("save");
    setNotice(null);
    try {
      const saved = await window.sanctuary.saveComfyUiConfig({ enabled: nextEnabled, baseUrl: endpoint });
      setConfig(saved);
      setEndpoint(saved.baseUrl);
      setNotice({ tone: "success", text: saved.enabled ? "ComfyUI 本地桥接已显式启用" : "ComfyUI 桥接已关闭" });
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error, "保存失败") });
    } finally {
      setBusy("");
    }
  }

  async function test() {
    setBusy("test");
    setNotice(null);
    try {
      const result = await window.sanctuary.testComfyUiConnection();
      setNotice(result.success
        ? { tone: "success", text: `已连接本机 ComfyUI · ${result.latencyMs} ms` }
        : { tone: "error", text: result.error ?? "连接失败" });
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error, "连接测试失败") });
    } finally {
      setBusy("");
    }
  }

  async function importTemplate() {
    setBusy("import");
    setNotice(null);
    try {
      const imported = await window.sanctuary.importComfyUiTemplate();
      if (!imported) return;
      setTemplates(await window.sanctuary.listComfyUiTemplates());
      setNotice({ tone: "success", text: `已导入“${imported.name}” · ${imported.nodeCount} 个节点` });
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error, "工作流导入失败") });
    } finally {
      setBusy("");
    }
  }

  async function removeTemplate(id: string) {
    setBusy(id);
    try {
      await window.sanctuary.deleteComfyUiTemplate(id);
      setTemplates(await window.sanctuary.listComfyUiTemplates());
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error, "模板删除失败") });
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="user-profile-card comfy-settings-section">
      <header>
        <div>
          <p className="eyebrow">LOCAL GENERATION BRIDGE</p>
          <h2>ComfyUI 本地桥接</h2>
        </div>
        <label className="switch" title="显式启用或关闭 ComfyUI 桥接">
          <input
            type="checkbox"
            checked={config.enabled}
            disabled={busy === "save"}
            onChange={(event) => void save(event.target.checked)}
          />
          <span />
        </label>
      </header>
      <p className="page-description">
        只连接本机回环地址。图片只会在你从某张本地画作的“提示词调音台”点击发送时上传给本机 ComfyUI。
      </p>
      {notice && <AppNotice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</AppNotice>}
      <div className="comfy-config-row">
        <label>
          <span>本机地址</span>
          <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="http://127.0.0.1:8188" />
        </label>
        <Button busy={busy === "save"} busyLabel="保存中…" onClick={() => void save()}>保存地址</Button>
        <Button variant="secondary" busy={busy === "test"} busyLabel="连接中…" onClick={() => void test()}>测试连接</Button>
      </div>

      <div className="comfy-template-header">
        <div><strong>API 工作流模板</strong><small>请从 ComfyUI 导出“API Format” JSON；应用会自动识别前两个 CLIPTextEncode 和首个 LoadImage。</small></div>
        <Button variant="primary" busy={busy === "import"} busyLabel="校验中…" onClick={() => void importTemplate()}>导入工作流 JSON</Button>
      </div>
      {templates.length === 0 ? (
        <div className="comfy-empty">尚未导入工作流。没有模板时，调音台不会显示发送按钮。</div>
      ) : (
        <div className="comfy-template-list">
          {templates.map((template) => (
            <article key={template.id}>
              <div><strong>{template.name}</strong><small>{template.nodeCount} 节点 · 正向 {template.hasPositiveBinding ? "✓" : "×"} · 负向 {template.hasNegativeBinding ? "✓" : "可选"} · 参考图 {template.hasSourceImageBinding ? "✓" : "不使用"}</small></div>
              <Button variant="danger-soft" size="small" busy={busy === template.id} onClick={() => void removeTemplate(template.id)}>删除</Button>
            </article>
          ))}
        </div>
      )}

      {jobs.length > 0 && (
        <div className="comfy-recent-jobs">
          <strong>最近任务</strong>
          {jobs.slice(0, 5).map((job) => (
            <span key={job.id} className={job.status}>{job.templateName} · {jobLabel(job.status)}{job.error ? ` · ${job.error}` : ""}</span>
          ))}
        </div>
      )}
      <footer>不会读取任意本机路径；模板、响应体和生成图片都有严格体积与结构上限。</footer>
    </section>
  );
}

function jobLabel(status: ComfyUiJob["status"]): string {
  return { queued: "等待中", running: "生成中", completed: "已回收到画廊", failed: "失败", cancelled: "已取消" }[status];
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "") : fallback;
}
