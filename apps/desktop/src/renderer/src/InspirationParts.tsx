import { useEffect, useState } from "react";
import type { InspirationMessage, InspirationPresetId, InspirationSourceWork, InstalledModelView, WorkListItem, WorkRecord } from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import { DialogOverlay } from "./DialogOverlay";
import { Button } from "./Button";
import { Icon } from "./Icon";

export interface QuickPromptChip {
  label: string;
  prompt: string;
  presetId?: InspirationPresetId;
}

export function buildQuickPromptChips(hasImages: boolean, imageCount: number, hasAssistantReply: boolean, activeStarter: string): QuickPromptChip[] {
  if (hasAssistantReply) {
    return [
      {
        label: "提炼出图提示词",
        presetId: "prompt_notes",
        prompt: "请结合刚才的讨论和画面，整理出最终可直接用于生图的正向提示词（包含英文 Tag 与自然语言）以及负向约束。"
      },
      {
        label: "精简核心要点",
        prompt: "请把上面的回答浓缩成最核心、可直接使用的要点，去掉铺垫。"
      },
      ...(hasImages ? [{
        label: "补充画面细节",
        presetId: "image_chat" as const,
        prompt: "请再仔细看看画面里的光影、服装材质、背景小物件和人物神态，补充刚才没提到的细节。"
      }] : [])
    ];
  }
  if (hasImages) {
    return [
      {
        label: "提取英文 Tag",
        presetId: "prompt_notes",
        prompt: imageCount > 1
          ? "请综合这些参考图的核心视觉特征，提取一套可直接用于绘画的英文 Danbooru 标签（按主体、外貌、服饰、构图、光色分类）并附上负向约束。"
          : "请提取这张图的核心画面元素，整理为可直接用于绘画的英文 Danbooru 标签（按主体、外貌、服饰、环境、构图、光影分类）并附上负向约束。"
      },
      {
        label: "反推自然语言提示词",
        presetId: "prompt_notes",
        prompt: "请把画面整理成适合 FLUX / SDXL 的自然语言生图提示词，包含正向画面描述与负向约束。"
      },
      {
        label: "分析构图与配色",
        presetId: "image_chat",
        prompt: "请具体分析画面的构图层次、视觉焦点、光影方向与配色方案。"
      }
    ];
  }
  return [
    { label: "填入示例提问", prompt: activeStarter },
    {
      label: "构思画面提示词",
      presetId: "prompt_notes",
      prompt: "我想构思一张二次元插画，请帮我设计主体、环境、构图、光色，并整理成正向提示词与负向约束："
    }
  ];
}

/** Pieces of the creation page that do not hold its conversation state. */
export function InspirationMessageTimeline({ messages, pendingUserMessage, thinking, models = [], outputBusy = false, onCopyReply, onSaveReply, onImageReply }: {
  messages: InspirationMessage[];
  pendingUserMessage: string | null;
  thinking: boolean;
  models?: InstalledModelView[];
  outputBusy?: boolean;
  onCopyReply?: (messageId: string) => void;
  onSaveReply?: (messageId: string) => void;
  /** Present when local ComfyUI is ready and the conversation has a reference picture. */
  onImageReply?: ((messageId: string) => void) | undefined;
}) {
  return (
    <>
      {messages.map((message) => (
        <div key={message.id} className={`inspiration-message ${message.role}`}>
          <span>{message.role === "user" ? "你" : "本地模型"}</span>
          <div>{message.content}</div>
          {message.role === "assistant" && (
            <footer className="inspiration-reply-actions">
              <small>{message.provenance
                ? `${models.find((model) => model.id === message.provenance!.modelId)?.name ?? message.provenance.modelId} · ${(message.provenance.durationMs / 1000).toFixed(1)} 秒 · ${message.provenance.sources && message.provenance.sources.length > 1 ? `参考 ${message.provenance.sources.length} 张图` : message.provenance.source ? `参考第 ${message.provenance.source.pageIndex + 1} 页` : "纯文字"}`
                : "历史回答 · 来源未记录"}</small>
              <div>
                {onCopyReply && <Button variant="ghost" size="small" disabled={outputBusy} onClick={() => onCopyReply(message.id)}>复制回答</Button>}
                {onSaveReply && <Button variant="ghost" size="small" disabled={outputBusy} onClick={() => onSaveReply(message.id)}>保存 Markdown</Button>}
                {onImageReply && <Button variant="ghost" size="small" disabled={outputBusy} onClick={() => onImageReply(message.id)}>拿去出图</Button>}
              </div>
            </footer>
          )}
        </div>
      ))}
      {pendingUserMessage && (
        <div className="inspiration-message user queued" aria-live="polite">
          <span>你 · 已发送</span><div>{pendingUserMessage}</div>
        </div>
      )}
      {thinking && (
        <div className="inspiration-message assistant pending" aria-live="polite">
          <span>本地模型</span><div>正在认真想……</div>
        </div>
      )}
    </>
  );
}

export function ModelSettingControl<T extends string>({ label, value, options, disabled, onChange }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inspiration-setting-control">
      <span>{label}</span>
      <div>{options.map((option) => (
        <button key={option.value} type="button" disabled={disabled} className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}</div>
    </div>
  );
}

export function modelHint(model: InstalledModelView | undefined): string {
  if (!model) return "选择一个已安装模型";
  const tier = model.tier === "light" ? "更流畅" : model.tier === "advanced" ? "更细致" : "平衡档";
  return `${tier} · 建议显存 ${model.recommendedVramGb} GB`;
}

export function InspirationReferencePreviewDialog({ source, index, total, disabled, onClose, onReplace, onChangePage }: {
  source: InspirationSourceWork;
  index: number;
  total: number;
  disabled: boolean;
  onClose: () => void;
  onReplace: () => void;
  onChangePage: (work: WorkRecord, nextPageIndex: number) => void;
}) {
  const [work, setWork] = useState<WorkRecord | null>(null);
  useEffect(() => {
    let active = true;
    void window.sanctuary.getWork(source.workId).then((loaded) => {
      if (active) setWork(loaded);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [source.workId]);

  const availablePages = work?.assets.filter((asset) => asset.mediaType === "image" && asset.fileState === "available") ?? [];
  const currentPos = availablePages.findIndex((asset) => asset.pageIndex === source.pageIndex);

  return (
    <DialogOverlay onClose={onClose}>
      <section className="dialog-surface inspiration-reference-preview" role="dialog" aria-modal="true" aria-label="查看参考图">
        <header>
          <div>
            <h2>参考图 {index + 1}{total > 1 ? ` / ${total}` : ""} · {source.title}</h2>
            <p>{source.artistName ?? "本地作品"} · 第 {source.pageIndex + 1} 页{availablePages.length > 1 ? `（共 ${availablePages.length} 页可用）` : ""}</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭"><Icon name="close" size={16} /></button>
        </header>
        <div className="inspiration-reference-preview-stage">
          <img src={source.imageUrl} alt={source.title} />
        </div>
        <footer>
          {availablePages.length > 1 && work && (
            <div className="inspiration-reference-preview-pages">
              <Button
                size="small"
                disabled={disabled || currentPos <= 0}
                onClick={() => {
                  const prev = availablePages[currentPos - 1];
                  if (prev) onChangePage(work, prev.pageIndex);
                }}
              >上一页</Button>
              <Button
                size="small"
                disabled={disabled || currentPos < 0 || currentPos >= availablePages.length - 1}
                onClick={() => {
                  const next = availablePages[currentPos + 1];
                  if (next) onChangePage(work, next.pageIndex);
                }}
              >下一页</Button>
            </div>
          )}
          <div className="inspiration-reference-preview-actions">
            <Button size="small" disabled={disabled} onClick={onReplace}>更换这张参考图</Button>
            <Button variant="primary" size="small" onClick={onClose}>完成</Button>
          </div>
        </footer>
      </section>
    </DialogOverlay>
  );
}

export function InspirationGalleryPicker({ onClose, onSelect }: {
  onClose: () => void;
  onSelect: (work: WorkRecord, pageIndex: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState("");
  const [expandedWork, setExpandedWork] = useState<WorkRecord | null>(null);
  const [pickerError, setPickerError] = useState("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void window.sanctuary.queryWorks({
        ...(search.trim() ? { search: search.trim() } : {}),
        sortBy: "savedAt",
        direction: "desc",
        offset: 0,
        limit: 40
      }).then((result) => {
        if (active) setWorks(result.items.filter((item) => Boolean(item.coverAsset)));
      }).catch((caught) => {
        if (active) setPickerError(messageOf(caught));
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 160);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search]);

  async function openWork(item: WorkListItem) {
    setOpeningId(item.id);
    setPickerError("");
    try {
      const work = await window.sanctuary.getWork(item.id);
      if (!work) throw new Error("这件作品已经不在图库里了");
      const pages = work.assets.filter((asset) => asset.mediaType === "image" && asset.fileState === "available");
      if (pages.length === 0) throw new Error("这件作品暂时没有可用的本地图片");
      if (pages.length === 1) onSelect(work, pages[0]!.pageIndex);
      else setExpandedWork(work);
    } catch (caught) {
      setPickerError(messageOf(caught));
    } finally {
      setOpeningId("");
    }
  }

  const availablePages = expandedWork?.assets.filter(
    (asset) => asset.mediaType === "image" && asset.fileState === "available"
  ) ?? [];

  return (
    <DialogOverlay onClose={onClose}>
      <section className="inspiration-picker" role="dialog" aria-modal="true" aria-label="从图库选择参考图">
        <header>
          <div>
            <h2>{expandedWork ? "选择具体一页" : "从图库加入参考图"}</h2>
            <p>{expandedWork ? `《${expandedWork.title}》共有 ${availablePages.length} 张可用图片` : "最近保存的作品会排在前面，也可以按标题或画师搜索。"}</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭"><Icon name="close" size={16} /></button>
        </header>
        {expandedWork ? (
          <>
            <button type="button" className="inspiration-picker-back" onClick={() => setExpandedWork(null)}><Icon name="chevronLeft" size={14} /> 返回作品列表</button>
            <div className="inspiration-picker-pages">
              {availablePages.map((asset) => (
                <button key={asset.id} type="button" onClick={() => onSelect(expandedWork, asset.pageIndex)}>
                  <img src={localImageUrl(asset.thumbnailPath ?? asset.path)} alt={`第 ${asset.pageIndex + 1} 页`} loading="lazy" />
                  <span>第 {asset.pageIndex + 1} 页</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <label className="inspiration-picker-search">
              <Icon name="search" size={16} />
              <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索作品标题或画师……" />
            </label>
            {pickerError && <AppNotice tone="error">{pickerError}</AppNotice>}
            <div className="inspiration-picker-grid" aria-busy={loading}>
              {works.map((item) => {
                const cover = item.coverAsset!;
                return (
                  <button key={item.id} type="button" disabled={openingId === item.id} onClick={() => void openWork(item)}>
                    <img src={localImageUrl(cover.thumbnailPath ?? cover.path)} alt="" loading="lazy" />
                    {item.pageCount > 1 && <span className="inspiration-picker-page-count"><Icon name="pages" size={12} /> {item.pageCount}</span>}
                    <div><strong>{item.title}</strong><small>{item.artistName ?? "本地作品"}</small></div>
                  </button>
                );
              })}
              {!loading && works.length === 0 && <p className="inspiration-picker-empty">没有找到可用图片，换个关键词试试。</p>}
            </div>
          </>
        )}
      </section>
    </DialogOverlay>
  );
}

export function imageUrlFor(work: WorkRecord, pageIndex: number): string {
  const asset = work.assets.find((item) => item.pageIndex === pageIndex) ?? work.assets[0];
  return asset ? `sanctuary-image://local/${encodeURIComponent(asset.path)}` : "";
}

export function localImageUrl(path: string): string {
  return `sanctuary-image://local/${encodeURIComponent(path)}`;
}

export function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "刚刚" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

export function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : "本地模型暂时没有成功回应";
}

