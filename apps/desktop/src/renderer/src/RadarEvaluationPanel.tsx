import { useEffect, useMemo, useState } from "react";
import type {
  ExternalVisionProviderId,
  ExternalVisionPublicConfig,
  VisionEvaluationResult
} from "@sanctuary/domain";
import { Button } from "./Button";
import { VisionRadarChart } from "./VisionRadarChart";

const PROVIDERS: ExternalVisionProviderId[] = ["openai_compatible", "openai", "gemini", "anthropic"];

export function RadarEvaluationPanel({
  workId,
  evaluations,
  onEvaluationsChange
}: {
  workId: string;
  evaluations: VisionEvaluationResult[];
  onEvaluationsChange: (evaluations: VisionEvaluationResult[]) => void;
}) {
  const [runningSuite, setRunningSuite] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState<ExternalVisionPublicConfig[]>([]);
  const activeProvider = useMemo(() => providers.find((provider) => provider.enabled), [providers]);
  const hasTechnicalProfile = evaluations.some((item) => item.suiteId === "technical_visual_v1");

  useEffect(() => {
    let cancelled = false;
    void Promise.all(PROVIDERS.map((provider) => window.sanctuary.getExternalVisionConfig(provider).catch(() => null)))
      .then((items) => {
        if (!cancelled) setProviders(items.filter((item): item is ExternalVisionPublicConfig => Boolean(item)));
      });
    return () => { cancelled = true; };
  }, []);

  async function run(suiteId: "technical_visual_v1" | "fine_art_v1") {
    setError("");
    setRunningSuite(suiteId);
    try {
      const result = await window.sanctuary.evaluateWorkVision({
        workId,
        suiteId,
        ...(suiteId === "fine_art_v1" && activeProvider ? { providerId: activeProvider.provider } : {})
      });
      if (result.status !== "success") {
        throw new Error(result.summary ?? `模型没有完成分析（${result.status}）`);
      }
      onEvaluationsChange(await window.sanctuary.listVisionEvaluationsForWork(workId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "画像生成失败");
    } finally {
      setRunningSuite(null);
    }
  }

  return (
    <div className="radar-evaluation-panel">
      <div className="radar-evaluation-actions">
        <div className="radar-evaluation-action-copy">
          <strong>本地技术画像</strong>
          <span>离线计算色彩、明暗、边缘和空间分布，不评价作品好坏。</span>
        </div>
        <Button
          size="small"
          variant="primary"
          disabled={hasTechnicalProfile}
          busy={runningSuite === "technical_visual_v1"}
          busyLabel="正在计算…"
          onClick={() => void run("technical_visual_v1")}
        >
          {hasTechnicalProfile ? "已生成" : "立即生成"}
        </Button>
      </div>

      <div className="radar-evaluation-actions radar-evaluation-actions--subjective">
        <div className="radar-evaluation-action-copy">
          <strong>AI 美术六维</strong>
          <span>{activeProvider ? `使用已启用的 ${activeProvider.model}` : "需先在设置中启用视觉评论服务，或等待本地评论模型运行时。"}</span>
        </div>
        <Button
          size="small"
          variant="secondary"
          disabled={!activeProvider}
          busy={runningSuite === "fine_art_v1"}
          busyLabel="正在解读…"
          onClick={() => void run("fine_art_v1")}
        >
          生成六维评价
        </Button>
      </div>

      {error && <p className="radar-evaluation-error" role="alert">{error}</p>}

      {evaluations.length === 0 ? (
        <div className="radar-drawer-empty">
          <p>这件作品还没有画像。</p>
          <p className="hint">可以先运行完全离线的“本地技术画像”。</p>
        </div>
      ) : (
        <div className="radar-drawer-content">
          {evaluations.map((evaluation) => (
            <VisionRadarChart key={evaluation.id} evaluation={evaluation} size={260} />
          ))}
        </div>
      )}
    </div>
  );
}
