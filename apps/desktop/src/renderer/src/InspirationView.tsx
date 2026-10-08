import { useEffect, useMemo, useRef, useState } from "react";
import type {
  InspirationCreativity,
  InspirationConversation,
  InspirationGenerationSettings,
  InspirationMessage,
  InspirationPresetId,
  InspirationResponseLength,
  InspirationSourceWork,
  InstalledModelView,
  WorkListItem,
  WorkRecord
} from "@sanctuary/domain";
import { DEFAULT_INSPIRATION_SETTINGS } from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import { DialogOverlay } from "./DialogOverlay";
import { Button } from "./Button";

const PRESETS: Array<{ id: InspirationPresetId; label: string; hint: string; starter: string }> = [
  { id: "chat", label: "随便聊聊", hint: "讨论灵感、设定和写作问题", starter: "我有一个想法，想和你一起把它梳理清楚：" },
  { id: "image_chat", label: "聊聊这张图", hint: "读画面、找细节和叙事线索", starter: "请认真看看这张图，先说说你看到了什么，再聊聊它可能藏着的故事。" },
  { id: "story_scene", label: "写成小说片段", hint: "从画面或想法写出一个完整场景", starter: "请以这张图或我的描述为起点，写成一个有动作、氛围和人物语气的小说场景。" },
  { id: "character_profile", label: "生成角色设定", hint: "外观、性格、动机和矛盾钩子", starter: "请把这个人物发展成可继续创作的角色设定。" },
  { id: "world_building", label: "生成世界观", hint: "环境规则、生活细节与冲突来源", starter: "请从这个画面或想法出发，建立一个有生活质感和冲突空间的世界观。" },
  { id: "prompt_notes", label: "整理提示词", hint: "转成结构清楚的生成提示词笔记", starter: "请把画面和我的要求整理成生成提示词笔记，分开主体、环境、构图、光色、材质与负向约束。" }
];

export function InspirationView({ launch, onLaunchConsumed, onOpenModelCenter }: {
  launch: { workId: string; pageIndex: number; sources?: Array<{workId:string;pageIndex:number}> } | null;
  onLaunchConsumed: () => void;
  onOpenModelCenter: () => void;
}) {
  const [conversations, setConversations] = useState<InspirationConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [sourceWork, setSourceWork] = useState<WorkRecord | null>(null);
  const [sourcePageIndex, setSourcePageIndex] = useState(0);
  const [extraSources, setExtraSources] = useState<InspirationSourceWork[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [appendReference, setAppendReference] = useState(false);
  const [presetId, setPresetId] = useState<InspirationPresetId>("chat");
  const [draft, setDraft] = useState("");
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState("");
  const [galleryPickerOpen, setGalleryPickerOpen] = useState(false);
  const [models, setModels] = useState<InstalledModelView[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [defaultModelId, setDefaultModelId] = useState("");
  const [modelId, setModelId] = useState("");
  const [settings, setSettings] = useState<InspirationGenerationSettings>({ ...DEFAULT_INSPIRATION_SETTINGS });
  const [pendingTurn, setPendingTurn] = useState<{ conversationId: string | null; userMessage: string | null; workspaceVersion: number } | null>(null);
  const [outputBusy, setOutputBusy] = useState("");
  const [outputNotice, setOutputNotice] = useState("");
  const workspaceVersion = useRef(0);
  const mounted = useRef(true);
  const sending = useRef(false);
  const referencesUpdating = useRef(false);
  const deleting = useRef(new Set<string>());
  const conversationDrafts = useRef(new Map<string, string>());
  const messagesRef = useRef<HTMLDivElement>(null);
  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const referenceSources: InspirationSourceWork[] = selected ? selected.sources ?? (selected.source ? [selected.source] : []) : sourceWork ? [{workId:sourceWork.id,title:sourceWork.title,artistName:sourceWork.artistName,pageIndex:sourcePageIndex,imageUrl:imageUrlFor(sourceWork,sourcePageIndex)},...extraSources] : [];
  const pendingVisible = Boolean(requestId) && pendingTurn?.conversationId === (selected?.id ?? null) &&
    (pendingTurn?.conversationId !== null || pendingTurn.workspaceVersion === workspaceVersion.current);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; workspaceVersion.current += 1; };
  }, []);

  useEffect(() => {
    const initialVersion = workspaceVersion.current;
    void window.sanctuary.listInspirationConversations()
      .then((items) => {
        if (!mounted.current) return;
        setConversations(items);
        if (!launch && items[0] && workspaceVersion.current === initialVersion) {
          setSelectedId(items[0].id);
          setModelId(items[0].modelId ?? "");
          setSettings(items[0].settings ?? { ...DEFAULT_INSPIRATION_SETTINGS });
        }
      })
      .catch((caught) => setError(messageOf(caught)));
    void window.sanctuary.getModelCenterSnapshot()
      .then((snapshot) => {
        if (!mounted.current) return;
        const installed = snapshot.models.filter((model) => model.capability === "art_critic" && model.installed && model.availability === "ready");
        const preferred = snapshot.activeByCapability.art_critic ?? installed[0]?.id ?? "";
        setModels(installed);
        setDefaultModelId(preferred);
        setModelId((current) => current || preferred);
      })
      .catch((caught) => setError(messageOf(caught)))
      .finally(() => { if (mounted.current) setModelsLoading(false); });
  }, []);

  useEffect(() => {
    if (!launch) return;
    const version = ++workspaceVersion.current;
    setSelectedId("");
    setSourceWork(null); setExtraSources([]); setSourcesLoading(false);
    setPresetId("image_chat");
    setModelId(defaultModelId);
    setSettings({ ...DEFAULT_INSPIRATION_SETTINGS });
    setDraft(PRESETS.find((item) => item.id === "image_chat")!.starter);
    setSourcePageIndex(launch.pageIndex); setSourcesLoading(true); setError("");
    const sources = launch.sources ?? [{workId:launch.workId,pageIndex:launch.pageIndex}];
    void Promise.all(sources.map(async source => {
      const work = await window.sanctuary.getWork(source.workId);
      if (!work || !work.assets.some(asset => asset.pageIndex === source.pageIndex && asset.mediaType === "image" && asset.fileState === "available")) throw new Error("参考图已经不可用，请重新选择");
      return {work,pageIndex:source.pageIndex};
    })).then(items => {
      if (mounted.current && workspaceVersion.current === version && items[0]) {
        setSourceWork(items[0].work); setSourcePageIndex(items[0].pageIndex);
        setExtraSources(items.slice(1).map(({work,pageIndex}) => ({workId:work.id,title:work.title,artistName:work.artistName,pageIndex,imageUrl:imageUrlFor(work,pageIndex)})));
        if (items.length > 1) setDraft("请逐张看看这些图片，比较它们的主体、画面元素和氛围，再回答我的问题。");
      }
    }).catch(caught => { if (mounted.current && workspaceVersion.current === version) setError(messageOf(caught)); })
      .finally(() => { if (mounted.current && workspaceVersion.current === version) { setSourcesLoading(false); onLaunchConsumed(); } });
  }, [launch]);

  useEffect(() => {
    const messages = messagesRef.current;
    if (messages) messages.scrollTop = messages.scrollHeight;
  }, [selected?.id, selected?.messages.length, requestId]);

  const activePreset = useMemo(
    () => PRESETS.find((item) => item.id === (selected?.presetId ?? presetId)) ?? PRESETS[0]!,
    [presetId, selected?.presetId]
  );

  function beginNew() {
    if (selectedId) conversationDrafts.current.set(selectedId, draft);
    workspaceVersion.current += 1;
    setSelectedId("");
    setSourceWork(null); setExtraSources([]); setSourcesLoading(false);
    setSourcePageIndex(0);
    setPresetId("chat");
    setModelId(defaultModelId);
    setSettings({ ...DEFAULT_INSPIRATION_SETTINGS });
    setDraft("");
    setError("");
    setOutputNotice("");
  }

  function selectConversation(conversation: InspirationConversation) {
    if (selectedId) conversationDrafts.current.set(selectedId, draft);
    workspaceVersion.current += 1;
    setSelectedId(conversation.id);
    setSourceWork(null); setExtraSources([]); setSourcesLoading(false);
    setModelId(conversation.modelId ?? defaultModelId);
    setSettings(conversation.settings ?? { ...DEFAULT_INSPIRATION_SETTINGS });
    setError("");
    setOutputNotice("");
    setDraft(conversationDrafts.current.get(conversation.id) ?? "");
  }

  function choosePreset(next: typeof PRESETS[number]) {
    if (selected) beginNew();
    setPresetId(next.id);
    setDraft(next.starter);
  }

  async function send() {
    const message = draft.trim();
    if (!message || referencesUpdating.current || sourcesLoading || sending.current || requestId || modelsLoading || models.length === 0) return;
    sending.current = true;
    const version = workspaceVersion.current;
    const nextRequestId = crypto.randomUUID();
    setRequestId(nextRequestId);
    setPendingTurn({ conversationId: selected?.id ?? null, userMessage: message, workspaceVersion: version });
    setError("");
    setDraft("");
    if (selected) conversationDrafts.current.delete(selected.id);
    try {
      const updated = await window.sanctuary.sendInspirationMessage({
        requestId: nextRequestId,
        presetId: selected?.presetId ?? presetId,
        message,
        ...(modelId ? { modelId } : {}),
        settings,
        ...(selected ? { conversationId: selected.id } : {}),
        ...(!selected && sourceWork ? { sourceWorkId: sourceWork.id, sourcePageIndex, ...(extraSources.length ? {sources:referenceSources.map(({workId,pageIndex}) => ({workId,pageIndex}))} : {}) } : {})
      });
      if (mounted.current && !deleting.current.has(updated.id)) {
        setConversations((items) => [updated, ...items.filter((item) => item.id !== updated.id)]);
        if (workspaceVersion.current === version) {
          setSelectedId(updated.id);
          setSourceWork(null); setExtraSources([]); setSourcesLoading(false);
        }
      }
    } catch (caught) {
      if (mounted.current && workspaceVersion.current === version) {
        setDraft((current) => current || message);
        setError(messageOf(caught));
      }
      const latest = await window.sanctuary.listInspirationConversations().catch(() => null);
      if (latest && mounted.current) {
        setConversations(latest);
        if (workspaceVersion.current === version && !selectedId && latest[0]) setSelectedId(latest[0].id);
      }
    } finally {
      sending.current = false;
      if (mounted.current) { setPendingTurn(null); setRequestId(""); }
    }
  }

  async function regenerate() {
    if (!selected || sending.current || requestId || modelsLoading || models.length === 0) return;
    sending.current = true;
    const version = workspaceVersion.current;
    const nextRequestId = crypto.randomUUID();
    setRequestId(nextRequestId);
    setPendingTurn({ conversationId: selected.id, userMessage: null, workspaceVersion: version });
    setError("");
    try {
      const updated = await window.sanctuary.regenerateInspirationMessage({
        conversationId: selected.id,
        requestId: nextRequestId,
        ...(modelId ? { modelId } : {}),
        settings
      });
      if (mounted.current && !deleting.current.has(updated.id)) {
        setConversations((items) => [updated, ...items.filter((item) => item.id !== updated.id)]);
      }
    } catch (caught) {
      if (mounted.current && workspaceVersion.current === version) setError(messageOf(caught));
    } finally {
      sending.current = false;
      if (mounted.current) { setPendingTurn(null); setRequestId(""); }
    }
  }

  async function removeConversation(id: string) {
    deleting.current.add(id);
    const version = workspaceVersion.current;
    try {
      await window.sanctuary.deleteInspirationConversation(id);
      if (!mounted.current) return;
      setConversations((items) => items.filter((item) => item.id !== id));
      if (selectedId === id && workspaceVersion.current === version) beginNew();
    } catch (caught) {
      if (mounted.current && workspaceVersion.current === version) setError(messageOf(caught));
    } finally { deleting.current.delete(id); }
  }

  async function outputConversation(mode: "copy" | "save" | "reply", messageId?: string) {
    if (!selected || outputBusy) return;
    const version = workspaceVersion.current;
    const request = { conversationId: selected.id, ...(messageId ? { messageId } : {}) };
    setOutputBusy(messageId ?? mode);
    setOutputNotice("");
    setError("");
    try {
      let notice = "";
      if (mode === "save") {
        const result = await window.sanctuary.exportInspirationMarkdown(request);
        if (!result.canceled) notice = `已保存 ${result.fileName ?? "Markdown 文档"}`;
      } else if (mode === "reply" && messageId) {
        await window.sanctuary.copyInspirationMessage({ conversationId: selected.id, messageId });
        notice = "回答已复制";
      } else {
        await window.sanctuary.copyInspirationMarkdown(request);
        notice = "对话已复制为 Markdown";
      }
      if (mounted.current && workspaceVersion.current === version) setOutputNotice(notice);
    } catch (caught) {
      if (mounted.current && workspaceVersion.current === version) setError(messageOf(caught));
    } finally { if (mounted.current) setOutputBusy(""); }
  }

  async function updateReferences(sources: InspirationSourceWork[]) {
    const version = workspaceVersion.current;
    if (referencesUpdating.current) throw new Error("参考图正在更新，请稍候");
    referencesUpdating.current = true; setSourcesLoading(true);
    setError("");
    try {
      if (selected) {
        const updated = await window.sanctuary.updateInspirationSource({
          conversationId: selected.id, sourceWorkId: sources[0]?.workId ?? null,
          ...(sources[0] ? { sourcePageIndex: sources[0].pageIndex } : {}),
          sources: sources.map(({ workId, pageIndex }) => ({ workId, pageIndex }))
        });
        if (mounted.current && workspaceVersion.current === version) setConversations(items => [updated, ...items.filter(item => item.id !== updated.id)]);
      } else if (!sources.length) {
        setSourceWork(null); setExtraSources([]); setSourcePageIndex(0);
      } else {
        const work = await window.sanctuary.getWork(sources[0]!.workId);
        if (!work) throw new Error("参考作品已经不存在");
        if (mounted.current && workspaceVersion.current === version) {
          setSourceWork(work); setSourcePageIndex(sources[0]!.pageIndex); setExtraSources(sources.slice(1));
        }
      }
    } finally {
      referencesUpdating.current = false;
      if (mounted.current && workspaceVersion.current === version) setSourcesLoading(false);
    }
  }

  async function attachGalleryWork(work: WorkRecord, pageIndex: number) {
    const version = workspaceVersion.current;
    const source = {workId:work.id,title:work.title,artistName:work.artistName,pageIndex,imageUrl:imageUrlFor(work,pageIndex)};
    const next = appendReference ? [...referenceSources,source] : [source,...referenceSources.slice(1)];
    if (next.length > 4) { setError("一次最多讨论 4 张参考图"); return; }
    if (new Set(next.map(item => `${item.workId}:${item.pageIndex}`)).size !== next.length) { setError("这张图已经加入了，请选择另一张"); return; }
    try {
      await updateReferences(next);
      if (mounted.current && workspaceVersion.current === version) {
        setGalleryPickerOpen(false);
        if (presetId === "chat") setPresetId("image_chat");
        if (!draft.trim()) setDraft(PRESETS.find(item => item.id === "image_chat")!.starter);
      }
    } catch (caught) { if (mounted.current && workspaceVersion.current === version) setError(messageOf(caught)); }
  }
  async function detachGalleryWork(index: number) {
    try { await updateReferences(referenceSources.filter((_item,i) => i !== index)); }
    catch (caught) { if (mounted.current) setError(messageOf(caught)); }
  }

  return (
    <section className="inspiration-view">
      <header className="inspiration-header">
        <div><p className="eyebrow">LOCAL CREATIVE COMPANION</p><h1>创作</h1><p>加入参考图，聊画面、比较多图、写设定或整理提示词。图片与对话只留在本机。</p></div>
        <button type="button" className="inspiration-new" onClick={beginNew}>＋ 新对话</button>
      </header>

      {!modelsLoading && models.length === 0 && (
        <div className="inspiration-no-model inspiration-setup-notice" role="status">
          <p>先安装一个创作模型，就可以在本机聊图和写作。</p>
          <button type="button" onClick={onOpenModelCenter}>安装创作模型</button>
        </div>
      )}

      <div className="inspiration-layout">
        <aside className="inspiration-sessions">
          <div className="inspiration-panel-title"><strong>最近对话</strong><small>最多保留 30 段</small></div>
          {conversations.length === 0 && <p className="inspiration-muted">还没有对话。选一种方式开始就好。</p>}
          {conversations.map((item) => (
            <div key={item.id} className={`inspiration-session ${item.id === selectedId ? "active" : ""}`}>
              <button type="button" onClick={() => selectConversation(item)}>
                <strong>{item.title}</strong><small>{PRESETS.find((preset) => preset.id === item.presetId)?.label} · {formatTime(item.updatedAt)}</small>
              </button>
              <button type="button" className="inspiration-delete" aria-label={`删除 ${item.title}`} onClick={() => void removeConversation(item.id)}>×</button>
            </div>
          ))}
        </aside>

        <article className="inspiration-chat">
          {selected && selected.messages.length > 0 && (
            <div className="inspiration-conversation-actions">
              <strong>{selected.title}</strong>
              <div>
                <Button size="small" disabled={Boolean(outputBusy)} onClick={() => void outputConversation("copy")}>复制对话</Button>
                <Button size="small" disabled={Boolean(outputBusy)} onClick={() => void outputConversation("save")}>导出 Markdown</Button>
              </div>
              {pendingVisible && <small>仅包含已保存的消息，未完成回答不会导出。</small>}
            </div>
          )}
          {sourcesLoading && <p role="status">正在带入所选参考图…</p>}
          <div className="inspiration-reference-strip" aria-label="本轮参考图">{referenceSources.map((source,index) => <div key={`${source.workId}:${source.pageIndex}`} className="inspiration-source">
            <img src={source.imageUrl} alt={`参考图 ${index + 1}`} />
            <div><span>图片 {index + 1} · 第 {source.pageIndex + 1} 页</span><strong>{source.title}</strong><small>{source.artistName ?? "本地作品"}</small></div>
            <div className="inspiration-source-actions">
              {index === 0 && <button type="button" disabled={Boolean(requestId) || sourcesLoading} onClick={() => { setAppendReference(false); setGalleryPickerOpen(true); }}>更换</button>}
              <button type="button" aria-label={`移除参考图 ${index + 1}`} disabled={Boolean(requestId) || sourcesLoading} onClick={() => void detachGalleryWork(index)}>移除</button>
            </div>
          </div>)}</div>
          {referenceSources.length < 4 && <button type="button" className="inspiration-attach-empty" disabled={Boolean(requestId) || sourcesLoading} onClick={() => { setAppendReference(true); setGalleryPickerOpen(true); }}>
            <span>＋</span><strong>{referenceSources.length ? "再加入一张参考图" : "从画廊加入参考图"}</strong><small>最多 4 张；可以选择多页作品中的具体一页</small>
          </button>}
          <div ref={messagesRef} className="inspiration-messages" tabIndex={0} aria-label="对话消息">
            {!selected && !requestId && (
              <div className="inspiration-welcome">
                <span className="inspiration-orb">✦</span><h2>{sourceWork ? "把这张图变成新的灵感" : "今天想一起做点什么？"}</h2>
                <p>{sourceWork ? "参考图已经带进来了。选一个方向，或者直接改写下面的话。" : "不必先写完整提示词，像平时聊天一样说就可以。"}</p>
              </div>
            )}
            <InspirationMessageTimeline
              messages={selected?.messages ?? []}
              pendingUserMessage={pendingVisible ? pendingTurn?.userMessage ?? null : null}
              thinking={pendingVisible}
              models={models}
              outputBusy={Boolean(outputBusy)}
              onCopyReply={(messageId) => void outputConversation("reply", messageId)}
              onSaveReply={(messageId) => void outputConversation("save", messageId)}
            />
          </div>
          {error && <AppNotice tone="error">{error}</AppNotice>}
          {outputNotice && <AppNotice tone="success">{outputNotice}</AppNotice>}
          {requestId && !pendingVisible && <AppNotice tone="info">另一段对话正在生成。可以先写草稿，完成后回答会保存在原对话。</AppNotice>}
          <div className="inspiration-composer">
            <div className="inspiration-mode-pill">✦ {activePreset.label}</div>
            <textarea
              maxLength={referenceSources.length ? 2000 : 8000}
              value={draft}
              placeholder="把你的想法告诉本地模型……"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
              }}
            />
            <div className="inspiration-composer-actions">
              <small>Enter 发送 · Shift + Enter 换行</small>
              {requestId ? (
                <button type="button" className="inspiration-stop" onClick={() => void window.sanctuary.cancelInspirationMessage(requestId).catch((caught) => setError(messageOf(caught)))}>停止</button>
              ) : (
                <button type="button" className="inspiration-send" disabled={!draft.trim() || sourcesLoading || modelsLoading || models.length === 0} onClick={() => void send()}>发送</button>
              )}
            </div>
          </div>
          {selected?.messages.at(-1)?.role === "assistant" && !requestId && (
            <button type="button" className="inspiration-regenerate" disabled={modelsLoading || models.length === 0} onClick={() => void regenerate()}>↻ 换一种回答</button>
          )}
        </article>

        <aside className="inspiration-presets">
          <div className="inspiration-model-controls">
            <div className="inspiration-panel-title"><strong>本次模型</strong><small>仅影响灵感台</small></div>
            {models.length > 0 ? (
              <>
                <select value={modelId} disabled={Boolean(requestId)} onChange={(event) => setModelId(event.target.value)} aria-label="选择灵感台本地模型">
                  {modelId && !models.some((model) => model.id === modelId) && <option value={modelId}>原模型已不可用</option>}
                  {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
                <small className="inspiration-model-hint">{modelHint(models.find((model) => model.id === modelId))}</small>
              </>
            ) : (
              <p className="inspiration-muted">{modelsLoading ? "正在读取本地模型…" : "安装模型后可在这里选择。"}</p>
            )}
            <ModelSettingControl<InspirationCreativity>
              label="回答气质"
              value={settings.creativity}
              disabled={Boolean(requestId)}
              options={[{ value: "precise", label: "严谨" }, { value: "balanced", label: "均衡" }, { value: "imaginative", label: "放飞" }]}
              onChange={(creativity) => setSettings((current) => ({ ...current, creativity }))}
            />
            <ModelSettingControl<InspirationResponseLength>
              label="回答篇幅"
              value={settings.responseLength}
              disabled={Boolean(requestId)}
              options={[{ value: "brief", label: "简短" }, { value: "standard", label: "标准" }, { value: "detailed", label: "详细" }]}
              onChange={(responseLength) => setSettings((current) => ({ ...current, responseLength }))}
            />
            <p className="inspiration-next-answer-note">调整会从下一次回答开始生效。</p>
          </div>
          <div className="inspiration-panel-title"><strong>创作方式</strong><small>每次新对话选一种</small></div>
          {PRESETS.map((preset) => (
            <button key={preset.id} type="button" className={(selected?.presetId ?? presetId) === preset.id ? "active" : ""} onClick={() => choosePreset(preset)}>
              <strong>{preset.label}</strong><small>{preset.hint}</small>
            </button>
          ))}
          <div className="inspiration-boundary"><strong>资源有界</strong><p>会话最多 30 段，每段最多 80 条消息；传给模型的只取最近上下文，旧内容不会无限挤占内存。</p></div>
        </aside>
      </div>
      {galleryPickerOpen && (
        <InspirationGalleryPicker
          onClose={() => setGalleryPickerOpen(false)}
          onSelect={(work, pageIndex) => void attachGalleryWork(work, pageIndex)}
        />
      )}
    </section>
  );
}

export function InspirationMessageTimeline({ messages, pendingUserMessage, thinking, models = [], outputBusy = false, onCopyReply, onSaveReply }: {
  messages: InspirationMessage[];
  pendingUserMessage: string | null;
  thinking: boolean;
  models?: InstalledModelView[];
  outputBusy?: boolean;
  onCopyReply?: (messageId: string) => void;
  onSaveReply?: (messageId: string) => void;
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

function ModelSettingControl<T extends string>({ label, value, options, disabled, onChange }: {
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

function modelHint(model: InstalledModelView | undefined): string {
  if (!model) return "选择一个已安装模型";
  const tier = model.tier === "light" ? "更流畅" : model.tier === "advanced" ? "更细致" : "平衡档";
  return `${tier} · 建议显存 ${model.recommendedVramGb} GB`;
}

function InspirationGalleryPicker({ onClose, onSelect }: {
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
      if (!work) throw new Error("这件作品已经不在画廊里了");
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
      <section className="inspiration-picker" role="dialog" aria-modal="true" aria-label="从画廊选择参考图">
        <header>
          <div>
            <p className="eyebrow">LOCAL GALLERY</p>
            <h2>{expandedWork ? "选择具体一页" : "从画廊加入参考图"}</h2>
            <p>{expandedWork ? `《${expandedWork.title}》共有 ${availablePages.length} 张可用图片` : "最近保存的作品会排在前面，也可以按标题或画师搜索。"}</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        {expandedWork ? (
          <>
            <button type="button" className="inspiration-picker-back" onClick={() => setExpandedWork(null)}>← 返回作品列表</button>
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
              <span>⌕</span>
              <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索作品标题或画师……" />
            </label>
            {pickerError && <AppNotice tone="error">{pickerError}</AppNotice>}
            <div className="inspiration-picker-grid" aria-busy={loading}>
              {works.map((item) => {
                const cover = item.coverAsset!;
                return (
                  <button key={item.id} type="button" disabled={openingId === item.id} onClick={() => void openWork(item)}>
                    <img src={localImageUrl(cover.thumbnailPath ?? cover.path)} alt="" loading="lazy" />
                    {item.pageCount > 1 && <span className="inspiration-picker-page-count">▱ {item.pageCount}</span>}
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

function imageUrlFor(work: WorkRecord, pageIndex: number): string {
  const asset = work.assets.find((item) => item.pageIndex === pageIndex) ?? work.assets[0];
  return asset ? `sanctuary-image://local/${encodeURIComponent(asset.path)}` : "";
}

function localImageUrl(path: string): string {
  return `sanctuary-image://local/${encodeURIComponent(path)}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "刚刚" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : "本地模型暂时没有成功回应";
}
