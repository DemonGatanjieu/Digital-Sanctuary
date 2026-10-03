import { useEffect, useRef, useState } from "react";
import { ELEMENT_BLACKLIST_GROUPS, type CustomElementGroup, type ElementFilterSetting,
  type InstalledModelView, type RuleSandboxResult } from "@sanctuary/domain";
import type { ExploreState } from "../../preload/index";
import type { AppStatus } from "./AppSidebar";
import { AppNotice } from "./AppNotice";
import { Button } from "./Button";
import { ModelCenterView } from "./ModelCenterView";
import { PersonalPreferenceSection } from "./PersonalPreferenceSection";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { explorationModels, FilterChangeGate, filterSettingFor } from "./explore-protection-model";

export function ExploreProtectionPanel({ state, status, settings, customGroups, onSettingsChange,
  onCustomGroupsChange, onClose, busy, onBusyChange, onReloadPage }: {
  state: ExploreState; status: AppStatus | null; settings: ElementFilterSetting[];
  customGroups: CustomElementGroup[]; onSettingsChange: (settings: ElementFilterSetting[]) => void;
  onCustomGroupsChange: (groups: CustomElementGroup[]) => Promise<void>; onClose: () => void;
  busy: boolean; onBusyChange: (busy: boolean) => void;
  onReloadPage?: () => Promise<void>;
}) {
  const [models, setModels] = useState<InstalledModelView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [ruleSaved, setRuleSaved] = useState(false);
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [testResult, setTestResult] = useState<RuleSandboxResult | null>(null);
  const [customName, setCustomName] = useState("");
  const [customTags, setCustomTags] = useState("");
  const [customAliases, setCustomAliases] = useState("");
  const [customAction, setCustomAction] = useState<"hide" | "blur">("hide");
  const gate = useRef(new FilterChangeGate());
  const alive = useRef(true);
  const readGeneration = useRef(0);
  const previousBusy = useRef(busy);

  async function refresh() {
    const generation = ++readGeneration.current;
    const [snapshot, stored] = await Promise.all([
      window.sanctuary.getModelCenterSnapshot(), window.sanctuary.listFilterSettings()
    ]);
    if (!alive.current || generation !== readGeneration.current) return;
    setModels(explorationModels(snapshot.models));
    onSettingsChange(stored);
    setLoaded(true);
  }

  useEffect(() => {
    alive.current = true;
    document.querySelector<HTMLButtonElement>(".protection-panel-close")?.focus();
    void refresh().catch((reason) => { if (alive.current) setError(errorText(reason)); });
    return () => { alive.current = false; readGeneration.current++; };
  }, []);

  useEffect(() => {
    const wasBusy = previousBusy.current;
    previousBusy.current = busy;
    // A mutation can finish in an older, closed panel. Read its committed model too.
    if (wasBusy && !busy) void refresh().catch((reason) => { if (alive.current) setError(errorText(reason)); });
  }, [busy]);

  async function perform(operation: () => Promise<void>, notice: string) {
    if (gate.current.busy || busy) return;
    readGeneration.current++;
    onBusyChange?.(true); setError(""); setMessage("");
    try {
      await gate.current.run(operation);
      if (alive.current) setMessage(notice);
    } catch (reason) {
      if (alive.current) setError(errorText(reason));
    } finally {
      onBusyChange?.(false);
    }
  }

  function saveRule(setting: ElementFilterSetting) {
    return perform(async () => {
      const stored = await window.sanctuary.updateFilterSetting(setting);
      onSettingsChange(stored);
      if (alive.current) { setRuleSaved(true); setThresholds((current) => {
        const { [setting.groupId]: _discard, ...remaining } = current;
        return remaining;
      }); }
    }, "规则已保存，应用于探索中的后续检查。");
  }

  const groups = [...ELEMENT_BLACKLIST_GROUPS, ...customGroups];
  const currentModel = models.find((model) => model.active);
  const locked = busy || !loaded;
  return <aside className="explore-protection-panel" aria-label="浏览保护">
    <header className="protection-panel-heading">
      <div><h2>浏览保护</h2><p>在这里选择不想看到的内容。</p></div>
      <button type="button" className="protection-panel-close" onClick={onClose} aria-label="关闭浏览保护">✕</button>
    </header>
    <div className="protection-panel-body">
      <p className="protection-mode-note">{state.protectionStatus === "bypassed"
        ? "当前是无保护浏览。规则保存后，恢复保护才会开始检查。"
        : state.protectionStatus === "ready" ? "保护已开启；只隐藏命中你所选规则的图片。" : "模型就绪后开始保护浏览。"}</p>
      {error && <AppNotice tone="error" onDismiss={() => setError("")}>{error}</AppNotice>}
      {message && <AppNotice tone="success" onDismiss={() => setMessage("")}>{message}</AppNotice>}
      {ruleSaved && state.protectionStatus === "ready" && onReloadPage && <Button variant="secondary" size="small" disabled={locked}
        onClick={() => void perform(async () => { await onReloadPage(); if (alive.current) setRuleSaved(false); }, "已刷新页面，将使用当前规则重新检查。")}>按新规则重新检查本页</Button>}
      {!loaded && <Button size="small" busy={busy} onClick={() => void perform(refresh, "保护设置已读取。")}>重新读取设置</Button>}
      <section className="protection-rules" aria-label="隐藏哪些内容" aria-busy={busy}>
        <h3>隐藏哪些内容</h3>
        <p className="protection-section-hint">开关自动保存。R18 与裸露不参与这些规则。</p>
        {groups.map((group) => {
          const setting = filterSettingFor(group, settings);
          return <label className="protection-rule-row" data-rule-id={group.id} key={group.id}>
            <span><strong>{group.name}</strong><small>{group.id === "urination" ? "小便相关画面" : group.description}</small></span>
            <input type="checkbox" aria-label={`隐藏${group.name}`} checked={setting.enabled} disabled={locked}
              onChange={(event) => void saveRule({ ...setting, enabled: event.target.checked })} />
          </label>;
        })}
      </section>
      <section className="protection-model" aria-label="探索识别模型">
        <h3>识别模型</h3>
        <p className="protection-section-hint">用于探索拦截和图片标签识别。创作与画评使用各自的模型。</p>
        <strong className="protection-current-model">{currentModel?.name ?? (loaded ? "未找到可用识别模型" : "读取中…")}</strong>
        <SettingsDisclosure title="更换识别模型" description="选择本机已有模型，或按需安装。" name="explore-models">
          <label className="protection-model-select">本机模型
            <select aria-label="探索识别模型" value={currentModel?.id ?? ""} disabled={locked}
              onChange={(event) => {
                const modelId = event.target.value;
                void perform(async () => {
                  await window.sanctuary.activateModel(modelId);
                  await refresh();
                }, "识别模型选择已更新。");
              }}>
              {!currentModel && <option value="" disabled>选择模型</option>}
              {models.filter((model) => model.installed).map((model) => <option key={model.id} value={model.id}>{model.name}{model.bundled ? "（内置）" : ""}</option>)}
            </select>
          </label>
          <SettingsDisclosure title="安装其他识别模型" name="explore-model-install">
            <ModelCenterView embedded capability="element_tagging" onError={(reason) => setError(errorText(reason))}
              disabled={busy} onBusyChange={onBusyChange}
              onChanged={() => void refresh().catch((reason) => setError(errorText(reason)))} />
          </SettingsDisclosure>
        </SettingsDisclosure>
      </section>
      <SettingsDisclosure title="个人偏好" description="查看“少看类似”的记录，停用或重置。" name="explore-preferences">
        <PersonalPreferenceSection key={currentModel?.id ?? "loading"} />
      </SettingsDisclosure>
      <SettingsDisclosure title="测试一张图片" description="查看它是否会命中当前规则。" name="explore-test">
        <Button disabled={locked || !status?.visionReady} busy={busy} size="small" onClick={() => void perform(async () => {
          const result = await window.sanctuary.testFilterImage();
          if (alive.current) setTestResult(result);
        }, "图片检查已完成。")}>选择测试图片</Button>
        {testResult && <div className="protection-test-result"><strong>{testResult.fileName}</strong>
          <p>{testResult.decision.reasons.length ? testResult.decision.reasons.map((reason) => reason.label).join("、") : "未命中当前规则"}</p></div>}
      </SettingsDisclosure>
      <SettingsDisclosure title="高级规则与诊断" description="精确阈值、自定义标签和运行信息。" name="explore-advanced">
        <p className="protection-section-hint">阈值越低越敏感，也更容易误拦截；精确修改需要点击应用。</p>
        {groups.map((group) => {
          const setting = filterSettingFor(group, settings);
          const value = thresholds[group.id] ?? setting.minimumConfidence;
          return <details className="protection-advanced-rule" key={group.id}>
            <summary>{group.name}</summary>
            <div className="tag-list">{group.tags.map((tag) => <code key={tag}>{tag}</code>)}</div>
            <label>触发阈值 {Math.round(value * 100)}%
              <input type="range" aria-label={`${group.name}触发阈值`} min="0.05" max="0.95" step="0.05" value={value} disabled={locked}
                onChange={(event) => setThresholds({ ...thresholds, [group.id]: Number(event.target.value) })} />
            </label>
            <Button size="small" disabled={locked || value === setting.minimumConfidence} onClick={() => void saveRule({ ...setting, minimumConfidence: value })}>应用更改</Button>
            {group.id.startsWith("custom-") && <>
              <CustomRuleEditor group={group as CustomElementGroup} disabled={locked}
                onApply={(next) => void perform(() => onCustomGroupsChange(customGroups.map((item) => item.id === next.id ? next : item)), "自定义规则已保存。")} />
              <Button variant="danger-soft" size="small" disabled={locked} onClick={() => void perform(() => onCustomGroupsChange(customGroups.filter((item) => item.id !== group.id)), "自定义规则已删除。")}>删除此规则</Button>
            </>}
          </details>;
        })}
        <details className="protection-advanced-rule">
          <summary>新增自定义规则</summary>
          <div className="protection-custom-form">
            <input aria-label="自定义规则名称" value={customName} maxLength={80} placeholder="名称" onChange={(event) => setCustomName(event.target.value)} />
            <input aria-label="自定义规则标签" value={customTags} placeholder="WD 标签，逗号或空格分隔" onChange={(event) => setCustomTags(event.target.value)} />
            <input aria-label="自定义规则别名" value={customAliases} placeholder="可选别名" onChange={(event) => setCustomAliases(event.target.value)} />
            <select aria-label="自定义规则动作" value={customAction} onChange={(event) => setCustomAction(event.target.value as "hide" | "blur")}><option value="hide">隐藏</option><option value="blur">模糊</option></select>
            <Button disabled={locked || !customName.trim() || splitLabels(customTags).length === 0} onClick={() => void perform(async () => {
              await onCustomGroupsChange([...customGroups, { id: `custom-${crypto.randomUUID()}`, name: customName.trim(), description: "自定义规则",
                tags: splitLabels(customTags), aliases: splitLabels(customAliases), defaultThreshold: 0.35, action: customAction }]);
              if (alive.current) { setCustomName(""); setCustomTags(""); setCustomAliases(""); }
            }, "自定义规则已添加。")}>添加规则</Button>
          </div>
        </details>
        <dl className="protection-diagnostics"><dt>模型状态</dt><dd>{status?.visionState ?? "读取中"}</dd>
          <dt>放行 / 拦截</dt><dd>{state.approvedResources} / {state.blockedResources}</dd>
          <dt>检查中</dt><dd>{state.pendingResources + state.queuedResources}</dd>
          <dt>广告拦截</dt><dd>{state.blockedAds}</dd><dt>审查缓存命中</dt><dd>{state.remoteReviewCacheHits}</dd></dl>
      </SettingsDisclosure>
    </div>
  </aside>;
}

function CustomRuleEditor({ group, disabled, onApply }: { group: CustomElementGroup; disabled: boolean; onApply: (group: CustomElementGroup) => void }) {
  const [tags, setTags] = useState(group.tags.join(", "));
  const [aliases, setAliases] = useState(group.aliases.join(", "));
  const [action, setAction] = useState(group.action);
  return <div className="protection-custom-form">
    <input aria-label={`${group.name}标签`} value={tags} onChange={(event) => setTags(event.target.value)} />
    <input aria-label={`${group.name}别名`} value={aliases} onChange={(event) => setAliases(event.target.value)} />
    <select aria-label={`${group.name}动作`} value={action} onChange={(event) => setAction(event.target.value as "blur" | "hide")}><option value="hide">隐藏</option><option value="blur">模糊</option></select>
    <Button size="small" disabled={disabled || splitLabels(tags).length === 0} onClick={() => onApply({ ...group, tags: splitLabels(tags), aliases: splitLabels(aliases), action })}>应用标签更改</Button>
  </div>;
}

function splitLabels(value: string): string[] { return [...new Set(value.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean))]; }
function errorText(reason: unknown): string { return reason instanceof Error ? reason.message : "保护设置暂未保存，请重试。"; }
