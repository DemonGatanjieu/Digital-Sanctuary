import { useEffect, useState } from "react";
import type { ExternalVisionProviderId, ExternalVisionPublicConfig } from "@sanctuary/domain";
import { Button } from "./Button";
import { AppNotice } from "./AppNotice";

const PROVIDERS: Array<{ id: ExternalVisionProviderId; name: string; defaultModel: string; docUrl?: string }> = [
  { id: "openai", name: "OpenAI (GPT-4o / GPT-4o-mini)", defaultModel: "gpt-4o-mini" },
  { id: "openai_compatible", name: "OpenAI 兼容协议 (通义千问 / 本地模型等)", defaultModel: "qwen-vl-plus" },
  { id: "gemini", name: "Google Gemini (1.5 Flash / Pro)", defaultModel: "gemini-1.5-flash" },
  { id: "anthropic", name: "Anthropic (Claude 3.5 Sonnet)", defaultModel: "claude-3-5-sonnet-20241022" }
];

export function VisionSettingsSection() {
  const [selectedProvider, setSelectedProvider] = useState<ExternalVisionProviderId>("openai");
  const [config, setConfig] = useState<ExternalVisionPublicConfig | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [endpointInput, setEndpointInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latencyMs?: number; error?: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    loadConfig(selectedProvider);
  }, [selectedProvider]);

  async function loadConfig(provider: ExternalVisionProviderId) {
    if (!window.sanctuary?.getExternalVisionConfig) return;
    try {
      const cfg = await window.sanctuary.getExternalVisionConfig(provider);
      setConfig(cfg);
      setModelInput(cfg.model);
      setEndpointInput(cfg.endpoint || "");
      setApiKeyInput("");
      setTestResult(null);
    } catch (error) {
      console.error("Failed to load vision config", error);
    }
  }

  async function handleSave() {
    if (!window.sanctuary?.saveExternalVisionConfig || !config) return;
    setSaving(true);
    setNotice(null);
    try {
      const updated = await window.sanctuary.saveExternalVisionConfig(
        {
          ...config,
          model: modelInput.trim() || config.model,
          endpoint: endpointInput.trim() || undefined,
          enabled: true
        },
        apiKeyInput.trim() ? apiKeyInput.trim() : undefined
      );
      setConfig(updated);
      setApiKeyInput("");
      setNotice({ tone: "success", text: `${PROVIDERS.find((p) => p.id === selectedProvider)?.name} 配置已安全保存` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteKey() {
    if (!window.sanctuary?.deleteExternalVisionApiKey) return;
    try {
      await window.sanctuary.deleteExternalVisionApiKey(selectedProvider);
      await loadConfig(selectedProvider);
      setNotice({ tone: "success", text: "已从本地安全密钥库中清除该 API Key" });
    } catch (error) {
      setNotice({ tone: "error", text: "删除密钥失败" });
    }
  }

  async function handleTestConnection() {
    if (!window.sanctuary?.testExternalVisionConnection) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.sanctuary.testExternalVisionConnection(selectedProvider);
      setTestResult(res);
    } catch (error) {
      setTestResult({ success: false, error: error instanceof Error ? error.message : "连接异常" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="user-profile-card vision-settings-section">
      <div className="section-header">
        <div>
          <h2>外部画评服务</h2>
          <p className="page-description">
            仅在你主动请求云端画评时使用，密钥保存在本机系统密钥库。
          </p>
        </div>
      </div>

      {notice && <AppNotice tone={notice.tone}>{notice.text}</AppNotice>}

      <div className="provider-tabs" role="tablist">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`provider-tab-button ${selectedProvider === p.id ? "active" : ""}`}
            onClick={() => setSelectedProvider(p.id)}
            role="tab"
            aria-selected={selectedProvider === p.id}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="provider-config-form">
        <div className="form-group">
          <label htmlFor="vision-model-input">模型名称 (Model Identifier)</label>
          <input
            id="vision-model-input"
            type="text"
            className="text-input"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            placeholder={PROVIDERS.find((p) => p.id === selectedProvider)?.defaultModel}
          />
        </div>

        {selectedProvider === "openai_compatible" && (
          <div className="form-group">
            <label htmlFor="vision-endpoint-input">API Base URL (必须为 HTTPS)</label>
            <input
              id="vision-endpoint-input"
              type="text"
              className="text-input"
              value={endpointInput}
              onChange={(e) => setEndpointInput(e.target.value)}
              placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            />
          </div>
        )}

        <div className="form-group">
          <label htmlFor="vision-key-input">
            API 密钥 (API Key)
            {config?.hasApiKey && (
              <span className="key-configured-badge">
                已配置 (掩码: {config.keyHint || "••••"})
              </span>
            )}
          </label>
          <div className="api-key-input-row">
            <input
              id="vision-key-input"
              type="password"
              className="text-input"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={config?.hasApiKey ? "输入新 Key 以替换现有密钥" : "输入 API Key"}
              autoComplete="off"
            />
            {config?.hasApiKey && (
              <Button variant="secondary" onClick={handleDeleteKey}>
                清除密钥
              </Button>
            )}
          </div>
        </div>

        <div className="form-actions-row">
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "正在保存..." : "保存配置"}
          </Button>

          <Button
            variant="secondary"
            onClick={handleTestConnection}
            disabled={testing || !config?.hasApiKey}
            title={!config?.hasApiKey ? "请先配置并保存 API Key" : "发送测试图片验证 API 连通性"}
          >
            {testing ? "正在测试..." : "发送一次测试请求"}
          </Button>
        </div>

        {testResult && (
          <div className={`connection-test-result ${testResult.success ? "success" : "failure"}`}>
            {testResult.success ? (
              <p>✅ 连接成功！响应延迟: <strong>{testResult.latencyMs}ms</strong></p>
            ) : (
              <p>❌ 连接测试失败: {testResult.error}</p>
            )}
          </div>
        )}

        <div className="vision-privacy-notice">
          <p>
            💡 <strong>隐私与计费提示</strong>：
            仅当您在作品抽屉或任务中心<strong>显式点击“开始 AI 分析”</strong>时，才会向服务商发送所选画作。画廊浏览、下载与翻页绝不会在后台自动上传任何图片。
          </p>
        </div>
      </div>
    </section>
  );
}
