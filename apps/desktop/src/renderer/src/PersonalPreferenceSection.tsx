import { useEffect, useState } from "react";
import type { PersonalPreferenceProfileView } from "../../preload/index";
import { AppNotice } from "./AppNotice";
import { Button } from "./Button";

export function PersonalPreferenceSection() {
  const [profile, setProfile] = useState<PersonalPreferenceProfileView | null>(null);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [resetArmed, setResetArmed] = useState(false);

  useEffect(() => {
    let active = true;
    void window.sanctuary.listPersonalTagPreferences()
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(personalPreferenceError(reason, "个人偏好读取失败"));
      });
    return () => { active = false; };
  }, []);

  async function toggle(label: string, enabled: boolean) {
    setBusyLabel(label);
    setError("");
    try {
      setProfile(await window.sanctuary.togglePersonalTagPreference(label, enabled));
    } catch (reason) {
      setError(personalPreferenceError(reason, "偏好更新失败"));
    } finally {
      setBusyLabel("");
    }
  }

  async function reset() {
    if (!resetArmed) {
      setResetArmed(true);
      window.setTimeout(() => setResetArmed(false), 6_000);
      return;
    }
    setBusyLabel("__reset__");
    setError("");
    try {
      setProfile(await window.sanctuary.resetPersonalTagPreferences());
      setResetArmed(false);
    } catch (reason) {
      setError(personalPreferenceError(reason, "偏好重置失败"));
    } finally {
      setBusyLabel("");
    }
  }

  return (
    <section className="personal-preference-card">
      <header>
        <div>
          <strong>{profile?.available ? "本地画像已连接" : "等待本地模型"}</strong>
          <small>{profile
            ? `${profile.engine} · ${profile.engineVersion}`
            : "正在读取当前模型对应的偏好画像…"}</small>
        </div>
        {(profile?.entries.length ?? 0) > 0 && (
          <Button
            variant={resetArmed ? "danger" : "danger-soft"}
            size="small"
            busy={busyLabel === "__reset__"}
            busyLabel="正在重置…"
            onClick={() => void reset()}
          >
            {resetArmed ? "再点一次确认重置" : "重置学习画像"}
          </Button>
        )}
      </header>
      {error && <AppNotice tone="error" onDismiss={() => setError("")}>{error}</AppNotice>}
      {profile && profile.entries.length === 0 ? (
        <div className="personal-preference-empty">
          <strong>还没有学习记录</strong>
          <span>在探索图片左上角点击“少看类似”，确认标签后，这里会出现可管理的个人元素画像。</span>
        </div>
      ) : (
        <div className="personal-preference-list">
          {profile?.entries.map((entry) => (
            <article className={entry.enabled ? "" : "disabled"} key={entry.label}>
              <div className="personal-preference-name">
                <code>{entry.label}</code>
                <small>{entry.evidenceCount} 次明确反馈</small>
              </div>
              <details><summary>查看学习详情</summary><small>偏好权重 {Math.round(entry.weight * 100)}%</small></details>
              <label className="switch" title={`${entry.enabled ? "停用" : "启用"}${entry.label}偏好`}>
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  disabled={busyLabel === entry.label}
                  onChange={(event) => void toggle(entry.label, event.target.checked)}
                />
                <span />
              </label>
            </article>
          ))}
        </div>
      )}
      <footer>个人画像只影响在线探索遮罩；本地画廊始终按可信资源直接显示。</footer>
    </section>
  );
}

function personalPreferenceError(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : "";
  return message.includes("No handler registered")
    ? "当前窗口仍在使用旧版后端，请正常重启应用后再查看个人偏好。"
    : message || fallback;
}
