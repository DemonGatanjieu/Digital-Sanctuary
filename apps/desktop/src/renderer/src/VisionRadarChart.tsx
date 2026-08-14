import { useState } from "react";
import type { VisionDimensionScore, VisionEvaluationResult, VisionSuiteDefinition } from "@sanctuary/domain";

interface VisionRadarChartProps {
  evaluation?: VisionEvaluationResult | null;
  suite?: VisionSuiteDefinition | null;
  size?: number;
  interactive?: boolean;
}

export function VisionRadarChart({
  evaluation,
  suite,
  size = 280,
  interactive = true
}: VisionRadarChartProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  if (!evaluation && !suite) {
    return (
      <div className="radar-empty-container" style={{ width: size, height: size }}>
        <p className="radar-empty-text">暂无雷达图画像数据</p>
      </div>
    );
  }

  const dimensions: VisionDimensionScore[] = evaluation?.dimensions && evaluation.dimensions.length > 0
    ? evaluation.dimensions
    : (suite?.dimensions.map((d) => ({ key: d.key, label: d.label, score: 0 })) ?? []);

  const totalAxes = dimensions.length;
  if (totalAxes < 3) {
    return (
      <div className="radar-empty-container" style={{ width: size, height: size }}>
        <p className="radar-empty-text">至少需要 3 个维度生成雷达多边形</p>
      </div>
    );
  }

  const center = size / 2;
  const radius = center * 0.65;
  const angleStep = (Math.PI * 2) / totalAxes;

  // Concentric polygon web levels: 20%, 40%, 60%, 80%, 100%
  const webLevels = [0.2, 0.4, 0.6, 0.8, 1.0];

  const getCoordinates = (index: number, normalizedValue: number): [number, number] => {
    const angle = index * angleStep - Math.PI / 2;
    const r = radius * normalizedValue;
    return [center + r * Math.cos(angle), center + r * Math.sin(angle)];
  };

  const polygonPoints = dimensions
    .map((dim, idx) => {
      const normalized = Math.max(0, Math.min(100, dim.score)) / 100;
      const [x, y] = getCoordinates(idx, normalized);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const isLocalProfile = evaluation?.kind === "local_technical_profile";

  return (
    <div className="vision-radar-widget" style={{ width: size }}>
      <div className="vision-radar-header">
        <span className={`vision-radar-badge ${isLocalProfile ? "badge-local" : "badge-ai"}`}>
          {isLocalProfile ? "📊 确定性技术特征" : "🤖 AI 主观解读"}
        </span>
        {evaluation?.providerId && (
          <span className="vision-radar-provider">
            {evaluation.providerId} · {evaluation.modelId || "v1"}
          </span>
        )}
      </div>

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="vision-radar-svg"
        role="img"
        aria-label="图像多维特征雷达图"
      >
        <defs>
          <radialGradient id="radarAreaGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent-color, #705df2)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent-color, #705df2)" stopOpacity="0.1" />
          </radialGradient>
          <filter id="radarGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Concentric grid webs */}
        {webLevels.map((level) => {
          const points = dimensions
            .map((_, idx) => {
              const [x, y] = getCoordinates(idx, level);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ");
          return (
            <polygon
              key={`web-${level}`}
              points={points}
              className="radar-grid-web"
              fill="none"
              stroke="var(--line-color, rgba(255,255,255,0.12))"
              strokeWidth={level === 1.0 ? "1.5" : "1"}
              strokeDasharray={level === 1.0 ? "none" : "2,3"}
            />
          );
        })}

        {/* Spoke lines */}
        {dimensions.map((dim, idx) => {
          const [x, y] = getCoordinates(idx, 1.0);
          return (
            <line
              key={`spoke-${dim.key}`}
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              className="radar-grid-spoke"
              stroke="var(--line-color, rgba(255,255,255,0.12))"
              strokeWidth="1"
            />
          );
        })}

        {/* Data polygon */}
        <polygon
          points={polygonPoints}
          className="radar-data-polygon"
          fill="url(#radarAreaGradient)"
          stroke="var(--accent-color, #705df2)"
          strokeWidth="2.5"
          filter="url(#radarGlow)"
        />

        {/* Vertex points & labels */}
        {dimensions.map((dim, idx) => {
          const normalized = Math.max(0, Math.min(100, dim.score)) / 100;
          const [vx, vy] = getCoordinates(idx, normalized);
          const [lx, ly] = getCoordinates(idx, 1.22);
          const isHovered = hoveredKey === dim.key;

          return (
            <g
              key={`vertex-${dim.key}`}
              className={`radar-vertex-group ${isHovered ? "hovered" : ""}`}
              onMouseEnter={() => interactive && setHoveredKey(dim.key)}
              onMouseLeave={() => interactive && setHoveredKey(null)}
              tabIndex={0}
              role="button"
              aria-label={`${dim.label}: ${dim.score}分`}
            >
              <circle
                cx={vx}
                cy={vy}
                r={isHovered ? 6 : 4}
                className="radar-vertex-dot"
                fill="var(--accent-color, #705df2)"
                stroke="#fff"
                strokeWidth="1.5"
              />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="central"
                className="radar-label-text"
                fill={isHovered ? "var(--text-bright, #fff)" : "var(--text-muted, #94a3b8)"}
                fontSize={isHovered ? "11px" : "10px"}
                fontWeight={isHovered ? "600" : "400"}
              >
                {dim.label}
              </text>
              <text
                x={lx}
                y={ly + 12}
                textAnchor="middle"
                dominantBaseline="central"
                className="radar-score-text"
                fill="var(--accent-color, #705df2)"
                fontSize="9px"
                fontWeight="700"
              >
                {Math.round(dim.score)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Rationale or explanation on hover */}
      {hoveredKey && (
        <div className="radar-tooltip">
          {(() => {
            const activeDim = dimensions.find((d) => d.key === hoveredKey);
            return (
              <p>
                <strong>{activeDim?.label} ({Math.round(activeDim?.score ?? 0)}分):</strong>{" "}
                {activeDim?.explanation || "确定性统计评分"}
              </p>
            );
          })()}
        </div>
      )}

      {evaluation?.summary && (
        <p className="vision-radar-summary">“{evaluation.summary}”</p>
      )}
    </div>
  );
}
