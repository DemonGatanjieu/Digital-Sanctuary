import { useEffect, useMemo, useRef, useState } from "react";
import type {
  InspirationConversation,
  InspirationPresetId,
  WorkRecord
} from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";

const PRESETS: Array<{ id: InspirationPresetId; label: string; hint: string; starter: string }> = [
  { id: "chat", label: "随便聊聊", hint: "讨论灵感、设定和写作问题", starter: "我有一个想法，想和你一起把它梳理清楚：" },
  { id: "image_chat", label: "聊聊这张图", hint: "读画面、找细节和叙事线索", starter: "请认真看看这张图，先说说你看到了什么，再聊聊它可能藏着的故事。" },
  { id: "story_scene", label: "写成小说片段", hint: "从画面或想法写出一个完整场景", starter: "请以这张图或我的描述为起点，写成一个有动作、氛围和人物语气的小说场景。" },
  { id: "character_profile", label: "生成角色设定", hint: "外观、性格、动机和矛盾钩子", starter: "请把这个人物发展成可继续创作的角色设定。" },
  { id: "world_building", label: "生成世界观", hint: "环境规则、生活细节与冲突来源", starter: "请从这个画面或想法出发，建立一个有生活质感和冲突空间的世界观。" },
  { id: "prompt_notes", label: "整理提示词", hint: "转成结构清楚的生成提示词笔记", starter: "请把画面和我的要求整理成生成提示词笔记，分开主体、环境、构图、光色、材质与负向约束。" }
];

export function InspirationView({ launch, onLaunchConsumed }: {
  launch: { workId: string; pageIndex: number } | null;
  onLaunchConsumed: () => void;
}) {
  const [conversations, setConversations] = useState<InspirationConversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [sourceWork, setSourceWork] = useState<WorkRecord | null>(null);
  const [sourcePageIndex, setSourcePageIndex] = useState(0);
  const [presetId, setPresetId] = useState<InspirationPresetId>("chat");
  const [draft, setDraft] = useState("");
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    void window.sanctuary.listInspirationConversations()
      .then((items) => {
        setConversations(items);
        if (!launch && items[0]) setSelectedId(items[0].id);
      })
      .catch((caught) => setError(messageOf(caught)));
  }, []);

  useEffect(() => {
    if (!launch) return;
    setSelectedId("");
    setPresetId("image_chat");
    setDraft(PRESETS.find((item) => item.id === "image_chat")!.starter);
    setSourcePageIndex(launch.pageIndex);
    void window.sanctuary.getWork(launch.workId)
      .then(setSourceWork)
      .catch((caught) => setError(messageOf(caught)))
      .finally(onLaunchConsumed);
  }, [launch?.workId, launch?.pageIndex]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected?.messages.length, requestId]);

  const activePreset = useMemo(
    () => PRESETS.find((item) => item.id === (selected?.presetId ?? presetId)) ?? PRESETS[0]!,
    [presetId, selected?.presetId]
  );

  function beginNew() {
    setSelectedId("");
    setSourceWork(null);
    setSourcePageIndex(0);
    setPresetId("chat");
    setDraft("");
    setError("");
  }

  function choosePreset(next: typeof PRESETS[number]) {
    if (selected) beginNew();
    setPresetId(next.id);
    setDraft(next.starter);
  }

  async function send() {
    const message = draft.trim();
    if (!message || requestId) return;
    const nextRequestId = crypto.randomUUID();
    setRequestId(nextRequestId);
    setError("");
    setDraft("");
    try {
      const updated = await window.sanctuary.sendInspirationMessage({
        requestId: nextRequestId,
        presetId: selected?.presetId ?? presetId,
        message,
        ...(selected ? { conversationId: selected.id } : {}),
        ...(!selected && sourceWork ? { sourceWorkId: sourceWork.id, sourcePageIndex } : {})
      });
      setConversations((items) => [updated, ...items.filter((item) => item.id !== updated.id)]);
      setSelectedId(updated.id);
      setSourceWork(null);
    } catch (caught) {
      setDraft(message);
      setError(messageOf(caught));
      const latest = await window.sanctuary.listInspirationConversations().catch(() => null);
      if (latest) {
        setConversations(latest);
        if (!selectedId && latest[0]) setSelectedId(latest[0].id);
      }
    } finally {
      setRequestId("");
    }
  }

  async function regenerate() {
    if (!selected || requestId) return;
    const nextRequestId = crypto.randomUUID();
    setRequestId(nextRequestId);
    setError("");
    try {
      const updated = await window.sanctuary.regenerateInspirationMessage({ conversationId: selected.id, requestId: nextRequestId });
      setConversations((items) => [updated, ...items.filter((item) => item.id !== updated.id)]);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setRequestId("");
    }
  }

  async function removeConversation(id: string) {
    await window.sanctuary.deleteInspirationConversation(id);
    const next = conversations.filter((item) => item.id !== id);
    setConversations(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? "");
  }

  return (
    <section className="inspiration-view">
      <header className="inspiration-header">
        <div><p className="eyebrow">LOCAL CREATIVE COMPANION</p><h1>本地灵感台</h1><p>让已经安装的视觉模型陪你读图、聊设定和写片段；图片与对话只留在本机。</p></div>
        <button type="button" className="inspiration-new" onClick={beginNew}>＋ 新对话</button>
      </header>

      <div className="inspiration-layout">
        <aside className="inspiration-sessions">
          <div className="inspiration-panel-title"><strong>最近对话</strong><small>最多保留 30 段</small></div>
          {conversations.length === 0 && <p className="inspiration-muted">还没有对话。选一种方式开始就好。</p>}
          {conversations.map((item) => (
            <div key={item.id} className={`inspiration-session ${item.id === selectedId ? "active" : ""}`}>
              <button type="button" onClick={() => { setSelectedId(item.id); setSourceWork(null); setError(""); }}>
                <strong>{item.title}</strong><small>{PRESETS.find((preset) => preset.id === item.presetId)?.label} · {formatTime(item.updatedAt)}</small>
              </button>
              <button type="button" className="inspiration-delete" aria-label={`删除 ${item.title}`} onClick={() => void removeConversation(item.id)}>×</button>
            </div>
          ))}
        </aside>

        <article className="inspiration-chat">
          {(selected?.source || sourceWork) && (
            <div className="inspiration-source">
              <img src={selected?.source?.imageUrl ?? imageUrlFor(sourceWork!, sourcePageIndex)} alt="参考作品" />
              <div><span>本地画廊参考</span><strong>{selected?.source?.title ?? sourceWork?.title}</strong><small>{selected?.source?.artistName ?? sourceWork?.artistName ?? "本地作品"}</small></div>
            </div>
          )}
          {!selected && !requestId && (
            <div className="inspiration-welcome">
              <span className="inspiration-orb">✦</span><h2>{sourceWork ? "把这张图变成新的灵感" : "今天想一起做点什么？"}</h2>
              <p>{sourceWork ? "参考图已经带进来了。选一个方向，或者直接改写下面的话。" : "不必先写完整提示词，像平时聊天一样说就可以。"}</p>
            </div>
          )}
          <div className="inspiration-messages">
            {selected?.messages.map((message) => (
              <div key={message.id} className={`inspiration-message ${message.role}`}>
                <span>{message.role === "user" ? "你" : "本地模型"}</span>
                <div>{message.content}</div>
              </div>
            ))}
            {requestId && <div className="inspiration-message assistant pending"><span>本地模型</span><div>正在认真想……</div></div>}
            <div ref={endRef} />
          </div>
          {error && <AppNotice tone="error">{error}</AppNotice>}
          <div className="inspiration-composer">
            <div className="inspiration-mode-pill">✦ {activePreset.label}</div>
            <textarea
              value={draft}
              placeholder="把你的想法告诉本地模型……"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
              }}
            />
            <div className="inspiration-composer-actions">
              <small>Enter 发送 · Shift + Enter 换行</small>
              {requestId ? (
                <button type="button" className="inspiration-stop" onClick={() => void window.sanctuary.cancelInspirationMessage(requestId)}>停止</button>
              ) : (
                <button type="button" className="inspiration-send" disabled={!draft.trim()} onClick={() => void send()}>发送</button>
              )}
            </div>
          </div>
          {selected?.messages.at(-1)?.role === "assistant" && !requestId && (
            <button type="button" className="inspiration-regenerate" onClick={() => void regenerate()}>↻ 换一种回答</button>
          )}
        </article>

        <aside className="inspiration-presets">
          <div className="inspiration-panel-title"><strong>创作方式</strong><small>每次新对话选一种</small></div>
          {PRESETS.map((preset) => (
            <button key={preset.id} type="button" className={(selected?.presetId ?? presetId) === preset.id ? "active" : ""} onClick={() => choosePreset(preset)}>
              <strong>{preset.label}</strong><small>{preset.hint}</small>
            </button>
          ))}
          <div className="inspiration-boundary"><strong>资源有界</strong><p>会话最多 30 段，每段最多 80 条消息；传给模型的只取最近上下文，旧内容不会无限挤占内存。</p></div>
        </aside>
      </div>
    </section>
  );
}

function imageUrlFor(work: WorkRecord, pageIndex: number): string {
  const asset = work.assets[pageIndex] ?? work.assets[0];
  return asset ? `sanctuary-image://local/${encodeURIComponent(asset.path)}` : "";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "刚刚" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : "本地模型暂时没有成功回应";
}
