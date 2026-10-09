import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { GenerationProvenance, VisionEvaluationResult, WorkRecord } from "@sanctuary/domain";
import { ElementInspectorDrawer } from "./ElementInspectorDrawer";
import { Icon } from "./Icon";
import { MenuItem, Popover } from "./Popover";
import { RadarEvaluationPanel } from "./RadarEvaluationPanel";
import { WorkInformationDrawer } from "./WorkInformationDrawer";
import { localImageUrl as workImageUrl } from "./image-url";
import { useCinemaViewer } from "./useCinemaViewer";
import { useWorkReading } from "./useWorkReading";
import { initialWorkPageIndex, isReadableWorkAsset } from "./work-reading";

export function WorkLightbox({ work, initialAssetId, onClose, onGenerated, onOpenInspiration, onError }: { work: WorkRecord; initialAssetId?: string; onClose: () => void; onGenerated: () => Promise<void> | void; onOpenInspiration: (workId: string, pageIndex: number) => void; onError: (error: unknown) => void }) {
  const [displayTitle, setDisplayTitle] = useState(work.title);
  useEffect(() => setDisplayTitle(work.title), [work.id, work.title]);
  const [pageIndex, setPageIndex] = useState(() => initialWorkPageIndex(work, initialAssetId));
  const [showRadar, setShowRadar] = useState(false);
  const [evaluations, setEvaluations] = useState<VisionEvaluationResult[]>([]);
  const [provenance, setProvenance] = useState<GenerationProvenance | null>(null);
  const [showProvenance, setShowProvenance] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [showInformation, setShowInformation] = useState(false);
  const [toolsAnchor, setToolsAnchor] = useState<HTMLElement | null>(null);
  const page = work.assets[pageIndex];
  const interactionSuspended = showInspector || showRadar || showProvenance || showInformation;
  const viewerPages = useMemo(() => work.assets.map((asset) => ({ url: workImageUrl(asset.path), width: asset.width, height: asset.height, byteLength: asset.byteLength })), [work.assets]);
  const viewer = useCinemaViewer({
    imageKey: page?.id ?? work.id, pages: viewerPages, pageIndex, onPageChange: setPageIndex, onClose,
    interactionSuspended,
    onDismissOverlay: showInspector ? undefined : showInformation ? () => setShowInformation(false) : showRadar ? () => setShowRadar(false) : showProvenance ? () => setShowProvenance(false) : undefined
  });
  const { zoom, nativeMode, isPanning, hudVisible, imageLoaded, imageFailed, resetHudTimer } = viewer;
  useWorkReading({ workId: work.id, assetId: page && isReadableWorkAsset(page) ? page.id : null, imageLoaded, onSaved: onGenerated, onError });

  useEffect(() => {
    let active = true;
    setEvaluations([]);
    setProvenance(null);
    if (window.sanctuary?.listVisionEvaluationsForWork) {
      window.sanctuary.listVisionEvaluationsForWork(work.id).then((values) => { if (active) setEvaluations(values); }).catch(() => {});
    }
    void window.sanctuary.getGenerationProvenance(work.id).then((value) => { if (active) setProvenance(value); }).catch(() => {});
    return () => { active = false; };
  }, [work.id]);

  if (!page) return null;

  return createPortal(
    <div
      ref={viewer.theaterRef}
      className={`cinema-lightbox-theater ${hudVisible ? "hud-visible" : "hud-hidden"}`}
      role="dialog"
      aria-modal="true"
      aria-label={displayTitle}
      data-display-profile={viewer.displayProfile}
      data-reduced-motion={viewer.reducedMotion}
      onMouseMove={resetHudTimer}
      onFocusCapture={resetHudTimer}
      tabIndex={-1}
    >
      <header className="cinema-hud-island viewer-bar">
        <div className="cinema-heading-group">
          <strong>{displayTitle}</strong>
          <small>{work.artistName ?? "本地作品"}{work.assets.length > 1 ? ` · 第 ${pageIndex + 1}/${work.assets.length} 页` : ""}</small>
        </div>

        <div className="cinema-controls-group">
          <button type="button" className="viewer-icon" aria-label="缩小" title="缩小（-）" onClick={() => viewer.changeZoom(zoom - 0.25)}><Icon name="zoomOut" /></button>
          <button type="button" className="viewer-readout" title="适应窗口（0）" onClick={viewer.resetZoom}>{viewer.zoomPercent}%</button>
          <button type="button" className="viewer-icon" aria-label="放大" title="放大（+）" onClick={() => viewer.changeZoom(zoom + 0.25)}><Icon name="zoomIn" /></button>
          <button type="button" className="viewer-text" aria-pressed={nativeMode} title="原始像素 / 适应窗口（1 或双击）" onClick={viewer.toggleNativeZoom}>
            {nativeMode ? "适应窗口" : "原始尺寸"}
          </button>
          <span className="viewer-divider" />
          <button type="button" className="viewer-icon" aria-label="作品信息" aria-pressed={showInformation} title="作品信息（相册、来源、取用）"
            onClick={() => { setShowInformation((value) => !value); setShowRadar(false); setShowInspector(false); setShowProvenance(false); }}><Icon name="info" /></button>
          <button type="button" className="viewer-icon" aria-label="更多工具" aria-haspopup="menu" aria-expanded={Boolean(toolsAnchor)} title="更多工具"
            onClick={(event) => setToolsAnchor(toolsAnchor ? null : event.currentTarget)}><Icon name="more" /></button>
          <button type="button" className="viewer-icon cinema-btn-close" aria-label="关闭大图" title="关闭（Esc）" onClick={onClose}><Icon name="close" /></button>
        </div>
      </header>
      {toolsAnchor && (
        <Popover anchor={toolsAnchor} label="更多工具" align="end" onClose={() => setToolsAnchor(null)} className="viewer-menu">
          <MenuItem icon="create" label="带着这张图去创作" onSelect={() => { setToolsAnchor(null); onClose(); onOpenInspiration(work.id, pageIndex); }} />
          <MenuItem icon="search" label="元素与提示词" onSelect={() => { setToolsAnchor(null); setShowInspector(true); setShowInformation(false); setShowRadar(false); setShowProvenance(false); }} />
          <MenuItem icon="filter" label="画像与画评" onSelect={() => { setToolsAnchor(null); setShowRadar(true); setShowInformation(false); setShowInspector(false); setShowProvenance(false); }} />
          {provenance && <MenuItem icon="info" label="生成来源" onSelect={() => { setToolsAnchor(null); setShowProvenance(true); setShowRadar(false); setShowInspector(false); setShowInformation(false); }} />}
        </Popover>
      )}

      {showRadar && (
        <aside className="cinema-radar-drawer" role="complementary" aria-label="画作多维视觉雷达图">
          <div className="radar-drawer-header">
            <h3>多维视觉画像</h3>
            <button type="button" className="radar-drawer-close" onClick={() => setShowRadar(false)} aria-label="关闭雷达图">✕</button>
          </div>
          <RadarEvaluationPanel
            workId={work.id}
            evaluations={evaluations}
            onEvaluationsChange={setEvaluations}
          />
        </aside>
      )}
      {showInformation && <WorkInformationDrawer workId={work.id} pageIndex={page.pageIndex} onClose={() => setShowInformation(false)}
        onInspector={() => { setShowInformation(false); setShowInspector(true); }} onRadar={() => { setShowInformation(false); setShowRadar(true); }}
        onInspiration={() => { onClose(); onOpenInspiration(work.id, pageIndex); }} onChanged={onGenerated} onRenamed={(renamed) => setDisplayTitle(renamed.title)} />}

      {showProvenance && provenance && (
        <aside className="cinema-radar-drawer generation-provenance-drawer" role="complementary" aria-label="生成来源与工作流摘要">
          <div className="radar-drawer-header">
            <h3>ComfyUI 生成来源</h3>
            <button type="button" className="radar-drawer-close" onClick={() => setShowProvenance(false)} aria-label="关闭来源信息">✕</button>
          </div>
          <div className="generation-provenance-content">
            <p><strong>工作流</strong><span>{provenance.templateName}</span></p>
            <p><strong>来源作品</strong><span>{provenance.sourceWorkId}</span></p>
            <p><strong>正向提示词</strong><code>{provenance.positivePrompt || "（空）"}</code></p>
            <p><strong>负向提示词</strong><code>{provenance.negativePrompt || "（空）"}</code></p>
            <p><strong>工作流摘要</strong><code>{JSON.stringify(provenance.workflowSummary, null, 2)}</code></p>
          </div>
        </aside>
      )}

      {showInspector && (
        <ElementInspectorDrawer
          target={{ workId: work.id, title: displayTitle, pageIndex }}
          onClose={() => setShowInspector(false)}
          onGenerated={onGenerated}
        />
      )}

      <div
        ref={viewer.stageRef}
        className={`cinema-stage-viewport ${isPanning ? "panning" : ""}`}
        onPointerDown={viewer.handlePointerDown}
        onPointerMove={viewer.handlePointerMove}
        onPointerUp={viewer.handlePointerUp}
        onPointerCancel={viewer.handlePointerUp}
        onLostPointerCapture={viewer.handlePointerUp}
        onDoubleClick={viewer.handleDoubleClick}
      >
        {!imageLoaded && !imageFailed && <div className="cinema-loading-spinner" role="status" aria-label="正在读取原图" />}
        {imageFailed && <div className="cinema-load-error" role="alert">原图读取失败，请检查本地文件是否存在。</div>}
        <img
          ref={viewer.imageRef}
          key={page.id}
          src={workImageUrl(page.path)}
          alt={displayTitle}
          className="cinema-image-entity"
          aria-busy={!imageLoaded}
          hidden={imageFailed}
          style={{
            cursor: zoom > 1 ? (isPanning ? "grabbing" : "grab") : "zoom-in"
          }}
          decoding="async"
          draggable={false}
          onLoad={viewer.onImageLoad}
          onError={viewer.onImageError}
        />
      </div>

      {pageIndex > 0 && (
        <button type="button" className="cinema-nav-arrow prev" aria-label="上一页" disabled={interactionSuspended} onClick={() => setPageIndex((v) => v - 1)}><Icon name="chevronLeft" size={28} /></button>
      )}
      {pageIndex < work.assets.length - 1 && (
        <button type="button" className="cinema-nav-arrow next" aria-label="下一页" disabled={interactionSuspended} onClick={() => setPageIndex((v) => v + 1)}><Icon name="chevronRight" size={28} /></button>
      )}

      {work.assets.length > 1 && (
        <div className="cinema-bottom-filmstrip">
          <div className="filmstrip-track">
            {work.assets.map((asset, idx) => (
              <button
                key={asset.id}
                type="button"
                className={`filmstrip-thumb-btn ${idx === pageIndex ? "active" : ""}`}
                title={`第 ${idx + 1} 页`}
                aria-label={`第 ${idx + 1} 页`}
                aria-current={idx === pageIndex ? "page" : undefined}
                disabled={interactionSuspended}
                onClick={() => setPageIndex(idx)}
              >
                <img src={workImageUrl(asset.thumbnailPath ?? asset.path)} alt="" loading="lazy" decoding="async" />
                <span className="thumb-page-badge">{idx + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
