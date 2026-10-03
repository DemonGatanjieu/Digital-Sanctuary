import { useEffect, useMemo, useRef, useState } from "react";
import type {
  InstalledModelView,
  ModelCapability,
  ModelCenterSnapshot,
  ModelDownloadProgress
} from "@sanctuary/domain";
import { Button } from "./Button";

const CAPABILITIES: { id: ModelCapability; label: string; description: string }[] = [
  { id: "element_tagging", label: "探索识别", description: "用于探索保护和图片标签识别" },
  { id: "art_critic", label: "画评与创作", description: "用于作品解读，以及创作页的聊图和写作" }
];

export function ModelCenterView({ onError, embedded = false, capability, onChanged, onBusyChange, disabled = false }: {
  onError: (error: unknown) => void; embedded?: boolean; capability?: ModelCapability; onChanged?: () => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<ModelCenterSnapshot | null>(null);
  const [activeCapability, setActiveCapability] = useState<ModelCapability>(capability ?? "element_tagging");
  const [busyModelId, setBusyModelId] = useState("");
  const [notice, setNotice] = useState("");

  const mutationPending = useRef(false);
  const readGeneration = useRef(0);
  const previousDisabled = useRef(disabled);
  function setModelBusy(id: string) { setBusyModelId(id); onBusyChange?.(Boolean(id)); }

  async function refresh() {
    const generation = ++readGeneration.current;
    const next = await window.sanctuary.getModelCenterSnapshot();
    if (generation === readGeneration.current) setSnapshot(next);
  }

  useEffect(() => {
    const wasDisabled = previousDisabled.current;
    previousDisabled.current = disabled;
    if (wasDisabled && !disabled) void refresh().catch(onError);
  }, [disabled]);

  useEffect(() => {
    void refresh().catch(onError);
    return window.sanctuary.onModelDownloadProgress((progress) => {
      setSnapshot((current) => current ? applyProgress(current, progress) : current);
      if (progress.phase === "complete") {
        setNotice("模型安装完成，可以切换使用了。");
        void refresh().catch(onError);
      }
      if (progress.phase === "failed" || progress.phase === "cancelled") setNotice(progress.message);
    });
  }, []);

  const models = useMemo(
    () => snapshot?.models.filter((model) => model.capability === activeCapability) ?? [],
    [activeCapability, snapshot]
  );
  const currentCapability = CAPABILITIES.find((item) => item.id === activeCapability)!;

  async function install(modelId: string) {
    if (disabled || mutationPending.current) return;
    mutationPending.current = true;
    setModelBusy(modelId);
    setNotice("");
    try {
      setSnapshot(await window.sanctuary.installModel(modelId));
      setNotice("模型安装完成，可以切换使用了。");
      onChanged?.();
    } catch (error) {
      if (!(error instanceof Error && /取消/.test(error.message))) onError(error);
    } finally {
      mutationPending.current = false;
      setModelBusy("");
    }
  }

  async function activate(modelId: string) {
    if (disabled || mutationPending.current) return;
    mutationPending.current = true;
    setModelBusy(modelId);
    setNotice("");
    try {
      const result = await window.sanctuary.activateModel(modelId);
      await refresh();
      setNotice(result.runtimeRestarted ? "模型已切换并通过启动自检。" : "模型已设为当前选择。");
      onChanged?.();
    } catch (error) {
      onError(error);
    } finally {
      mutationPending.current = false;
      setModelBusy("");
    }
  }

  async function remove(modelId: string) {
    if (disabled || mutationPending.current) return;
    mutationPending.current = true;
    setModelBusy(modelId);
    setNotice("");
    try {
      setSnapshot(await window.sanctuary.removeModel(modelId));
      setNotice("模型文件已从本机移除。");
      onChanged?.();
    } catch (error) {
      onError(error);
    } finally {
      mutationPending.current = false;
      setModelBusy("");
    }
  }

  async function deactivate(modelId: string) {
    if (disabled || mutationPending.current) return;
    mutationPending.current = true;
    setModelBusy(modelId);
    setNotice("");
    try {
      setSnapshot(await window.sanctuary.deactivateModel(modelId));
      setNotice("本地评论模型已停用，显存与内存会被释放。");
      onChanged?.();
    } catch (error) {
      onError(error);
    } finally {
      mutationPending.current = false;
      setModelBusy("");
    }
  }

  return (
    <section className="model-center-page">
      <header className={`${embedded ? "model-center-embedded-heading" : "topbar"} model-center-heading`}>
        <div>
          {!embedded && <><p className="eyebrow">LOCAL VISION ENGINE LIBRARY</p><h1>本地模型</h1></>}
          <p className="page-description">基础识别模型随应用提供。画评和创作模型可按需安装，安装后再选择使用。</p>
        </div>
        <Button variant="secondary" size="small" onClick={() => void window.sanctuary.openModelsDirectory()}>
          打开模型目录
        </Button>
      </header>

      {!capability && <section className="model-center-overview">
        <div className="model-orbit" aria-hidden="true"><span /><span /><i>DS</i></div>
        <div>
          <span className="model-kicker">本机视觉能力</span>
          <strong>{snapshot?.models.filter((model) => model.installed).length ?? 0} 个模型已安装</strong>
          <p>检测到约 {snapshot?.totalRamGb ?? "—"} GB 内存。推荐值是温和提示，不会阻止你自行尝试。</p>
        </div>
        <div className="model-overview-stat">
          <small>当前元素引擎</small>
          <b>{snapshot?.models.find((model) => model.active && model.capability === "element_tagging")?.name ?? "检测中"}</b>
        </div>
      </section>}

      {!capability && <nav className="model-capability-tabs" aria-label="模型能力分类">
        {CAPABILITIES.map((capability) => (
          <button
            key={capability.id}
            className={activeCapability === capability.id ? "active" : ""}
            aria-current={activeCapability === capability.id ? "page" : undefined}
            onClick={() => setActiveCapability(capability.id)}
          >
            <strong>{capability.label}</strong>
            <small>{snapshot?.models.filter((model) => model.capability === capability.id).length ?? 0}</small>
          </button>
        ))}
      </nav>}

      <div className="model-section-intro">
        <div><span>{currentCapability.label}</span><p>{currentCapability.description}</p></div>
        <small>{models.length > 0 ? `${models.length} 个经过登记的选择` : "还没有登记模型"}</small>
      </div>

      {notice && <div className="model-center-notice" role="status">{notice}</div>}

      <div className="model-card-grid">
        {models.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            busy={busyModelId === model.id}
            disabled={disabled || Boolean(busyModelId)}
            onInstall={() => void install(model.id)}
            onCancel={() => void window.sanctuary.cancelModelDownload(model.id)}
            onActivate={() => void activate(model.id)}
            onDeactivate={() => void deactivate(model.id)}
            onRemove={() => void remove(model.id)}
            onHomepage={() => void window.sanctuary.openModelHomepage(model.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ModelCard({
  model,
  busy,
  disabled,
  onInstall,
  onCancel,
  onActivate,
  onDeactivate,
  onRemove,
  onHomepage
}: {
  model: InstalledModelView;
  busy: boolean;
  disabled: boolean;
  onInstall: () => void;
  onCancel: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onRemove: () => void;
  onHomepage: () => void;
}) {
  const downloading = model.installState === "downloading";
  const progress = model.totalBytes > 0 ? Math.min(100, Math.round(model.downloadedBytes / model.totalBytes * 100)) : 0;
  return (
    <article className={`model-card ${model.active ? "active" : ""}`}>
      <header>
        <div className={`model-tier-mark ${model.tier}`} aria-hidden="true"><span /></div>
        <div className="model-card-title">
          <div className="model-badges">
            {model.badges.map((badge) => <span key={badge}>{badge}</span>)}
          </div>
          <h2>{model.name}</h2>
        </div>
        {model.active && <span className="model-active-pill">使用中</span>}
      </header>
      <p className="model-description">{model.description}</p>
      <p className="model-download-size">{model.bundled ? "随应用提供" : `下载 ${formatBytes(model.downloadSize)}`}</p>
      <details className="model-technical-details"><summary>资源需求与来源</summary>
      <p>{model.author} · {model.version}</p>
      <dl className="model-specs">
        <div><dt>下载</dt><dd>{formatBytes(model.downloadSize)}</dd></div>
        <div><dt>建议内存</dt><dd>{model.recommendedRamGb} GB</dd></div>
        <div><dt>建议显存</dt><dd>{model.recommendedVramGb} GB</dd></div>
        <div><dt>许可</dt><dd>{model.license}</dd></div>
      </dl>
      <Button variant="ghost" size="small" onClick={onHomepage}>模型主页 ↗</Button>
      </details>
      {downloading && (
        <div className="model-download-meter" aria-live="polite">
          <div><span>{progress}%</span><small>{formatBytes(model.downloadedBytes)} / {formatBytes(model.totalBytes)}</small></div>
          <progress max={100} value={progress} />
        </div>
      )}
      <footer>
        <div className="model-card-actions">
          {model.availability === "runtime_pending" ? (
            <span className="model-pending-label">运行时接入准备中</span>
          ) : downloading ? (
            <Button variant="danger-soft" size="small" onClick={onCancel}>暂停下载</Button>
          ) : !model.installed ? (
            <Button variant="primary" size="small" disabled={disabled} busy={busy} busyLabel="准备下载…" onClick={onInstall}>下载到本机</Button>
          ) : !model.active ? (
            <>
              {!model.bundled && <Button variant="ghost" size="small" disabled={disabled} onClick={onRemove}>删除</Button>}
              <Button variant="primary" size="small" disabled={disabled} busy={busy} busyLabel="启动自检…" onClick={onActivate}>切换使用</Button>
            </>
          ) : model.capability !== "element_tagging" ? (
            <Button variant="secondary" size="small" disabled={disabled} busy={busy} busyLabel="正在释放…" onClick={onDeactivate}>停用并释放</Button>
          ) : (
            <span className="model-ready-label">已安装并启用</span>
          )}
        </div>
      </footer>
    </article>
  );
}

function applyProgress(snapshot: ModelCenterSnapshot, progress: ModelDownloadProgress): ModelCenterSnapshot {
  return {
    ...snapshot,
    models: snapshot.models.map((model) => model.id === progress.modelId ? {
      ...model,
      installState:
        progress.phase === "complete" ? "installed" :
        progress.phase === "failed" ? "failed" :
        progress.phase === "cancelled" ? "available" :
        "downloading",
      downloadedBytes: progress.downloadedBytes,
      totalBytes: progress.totalBytes,
      ...(progress.phase === "failed" ? { error: progress.message } : {})
    } : model)
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}
