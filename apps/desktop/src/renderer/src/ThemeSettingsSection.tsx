import { useEffect, useState } from "react";
import type { InstalledTheme, StoreCatalogResponse, StoreThemeItem, ThemeDownloadProgress } from "@sanctuary/domain";
import { Button } from "./Button";
import { AppNotice } from "./AppNotice";

interface ThemeSettingsSectionProps {
  onThemeSwitchSuccess?: (themeName: string) => void;
}

export function ThemeSettingsSection({ onThemeSwitchSuccess }: ThemeSettingsSectionProps) {
  const [installedThemes, setInstalledThemes] = useState<InstalledTheme[]>([]);
  const [activeThemeId, setActiveThemeId] = useState<string>("default");
  const [loading, setLoading] = useState(true);
  const [switchingThemeId, setSwitchingThemeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Store state
  const [storeTab, setStoreTab] = useState<"installed" | "store">("installed");
  const [storeCatalog, setStoreCatalog] = useState<StoreCatalogResponse | null>(null);
  const [storeLoading, setStoreLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

  async function loadInstalledThemes() {
    try {
      setLoading(true);
      const [themes, active] = await Promise.all([
        window.sanctuary.getInstalledThemes(),
        window.sanctuary.getActiveTheme()
      ]);
      setInstalledThemes(themes);
      setActiveThemeId(active.themeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取主题列表失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInstalledThemes();

    const unsubChange = window.sanctuary.onThemeChanged((event) => {
      setActiveThemeId(event.activeThemeId);
      void loadInstalledThemes();
    });

    const unsubProgress = window.sanctuary.onDownloadProgress((event: ThemeDownloadProgress) => {
      setDownloadingId(event.themeId);
      setDownloadProgress(event.progress);
      if (event.progress >= 100) {
        setTimeout(() => {
          setDownloadingId(null);
          setDownloadProgress(0);
        }, 800);
      }
    });

    return () => {
      unsubChange();
      unsubProgress();
    };
  }, []);

  async function handleSwitchTheme(themeId: string) {
    try {
      setSwitchingThemeId(themeId);
      const result = await window.sanctuary.setActiveTheme(themeId);
      if (result.success) {
        setActiveThemeId(themeId);
        const matched = installedThemes.find((t) => t.id === themeId);
        onThemeSwitchSuccess?.(matched?.name ?? themeId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换主题失败");
    } finally {
      setSwitchingThemeId(null);
    }
  }

  async function handleDeleteTheme(themeId: string) {
    try {
      const ok = await window.sanctuary.deleteTheme(themeId);
      if (ok) {
        await loadInstalledThemes();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除主题失败");
    }
  }

  async function handleImportDialog() {
    try {
      const imported = await window.sanctuary.importThemeFromDialog();
      if (imported) {
        await loadInstalledThemes();
        await handleSwitchTheme(imported.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入主题失败");
    }
  }

  async function loadStoreCatalog(force = false) {
    try {
      setStoreLoading(true);
      setError(null);
      const catalog = await window.sanctuary.fetchStoreCatalog(force);
      setStoreCatalog(catalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取社区主题商店目录失败");
    } finally {
      setStoreLoading(false);
    }
  }

  async function handleInstallFromStore(theme: StoreThemeItem) {
    try {
      setDownloadingId(theme.id);
      setDownloadProgress(10);
      const installed = await window.sanctuary.installFromStore(theme.id);
      await loadInstalledThemes();
      await handleSwitchTheme(installed.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : `安装主题 ${theme.name} 失败`);
    } finally {
      setDownloadingId(null);
      setDownloadProgress(0);
    }
  }

  return (
    <section className="theme-settings-container">
      <header className="theme-settings-header">
        <div>
          <p className="eyebrow">THEMES & VISUALS</p>
          <h2>个性化主题与外观</h2>
          <p className="page-description">零刷新无缝热切换视觉风格，支持安装来自 GitHub 社区的二次元创意主题。</p>
        </div>

        <div className="theme-nav-toggle">
          <div className="segmented-control">
            <button
              type="button"
              className={storeTab === "installed" ? "active" : ""}
              onClick={() => setStoreTab("installed")}
            >
              已安装 ({installedThemes.length})
            </button>
            <button
              type="button"
              className={storeTab === "store" ? "active" : ""}
              onClick={() => {
                setStoreTab("store");
                if (!storeCatalog) void loadStoreCatalog();
              }}
            >
              社区商店 🌐
            </button>
          </div>
          {storeTab === "installed" ? (
            <Button variant="secondary" onClick={() => void handleImportDialog()}>
              📁 导入本地主题包
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={storeLoading}
              onClick={() => void loadStoreCatalog(true)}
            >
              🔄 刷新商店
            </Button>
          )}
        </div>
      </header>

      {error && <AppNotice tone="error" onDismiss={() => setError(null)}>{error}</AppNotice>}

      {storeTab === "installed" && (
        <div className="theme-grid">
          {loading ? (
            <div className="theme-loading-placeholder">正在加载已安装主题...</div>
          ) : (
            installedThemes.map((theme) => {
              const isActive = activeThemeId === theme.id;
              const isSwitching = switchingThemeId === theme.id;
              return (
                <div
                  key={theme.id}
                  className={`theme-card ${isActive ? "active" : ""} ${theme.isPreset ? "is-preset" : ""}`}
                >
                  <div className="theme-card-preview-container">
                    {theme.id === "default" ? (
                      <div className="theme-preset-preview default-preview">
                        <span className="preview-swatch blue" />
                        <span className="preview-swatch sky" />
                        <span className="preview-label">纯净蔚蓝 · 默认</span>
                      </div>
                    ) : theme.id === "builtin.hollow-zero" ? (
                      <div className="theme-preset-preview hollow-zero-preview">
                        <span className="preview-swatch amber" />
                        <span className="preview-swatch black" />
                        <span className="preview-label">空洞探索 · 绝区零</span>
                      </div>
                    ) : (
                      <div className="theme-custom-preview">
                        <span className="preview-label">{theme.name}</span>
                      </div>
                    )}
                    {isActive && <div className="active-badge">✓ 当前生效</div>}
                  </div>

                  <div className="theme-card-body">
                    <div className="theme-card-title-row">
                      <strong>{theme.name}</strong>
                      <span className="theme-version">v{theme.version}</span>
                    </div>
                    <p className="theme-author">作者：{theme.author}</p>
                    <p className="theme-description">{theme.description}</p>

                    <div className="theme-tags-row">
                      {theme.isPreset && <span className="theme-tag preset">官方内置</span>}
                      {theme.tags?.map((tag) => (
                        <span key={tag} className="theme-tag">{tag}</span>
                      ))}
                    </div>

                    <div className="theme-card-actions">
                      {isActive ? (
                        <Button variant="primary" disabled className="button-applied">
                          已应用
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          disabled={isSwitching}
                          onClick={() => void handleSwitchTheme(theme.id)}
                        >
                          {isSwitching ? "正在切换..." : "应用主题"}
                        </Button>
                      )}

                      {!theme.isPreset && (
                        <Button
                          variant="ghost"
                          onClick={() => void handleDeleteTheme(theme.id)}
                        >
                          删除
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {storeTab === "store" && (
        <div className="theme-store-section">
          {storeLoading && !storeCatalog ? (
            <div className="theme-loading-placeholder">正在连接 GitHub 社区主题仓库...</div>
          ) : storeCatalog && storeCatalog.themes.length > 0 ? (
            <div className="theme-grid">
              {storeCatalog.themes.map((item) => {
                const installed = installedThemes.find((t) => t.id === item.id);
                const isDownloading = downloadingId === item.id;
                const isUpToDate = installed && installed.version === item.version;

                return (
                  <div key={item.id} className="theme-card store-card">
                    <div className="theme-card-preview-container store-preview">
                      {item.previewImageUrl ? (
                        <img src={item.previewImageUrl} alt={item.name} loading="lazy" />
                      ) : (
                        <div className="theme-custom-preview">
                          <span className="preview-label">{item.name}</span>
                        </div>
                      )}
                      {installed && <div className="active-badge installed">已在本地</div>}
                    </div>

                    <div className="theme-card-body">
                      <div className="theme-card-title-row">
                        <strong>{item.name}</strong>
                        <span className="theme-version">v{item.version}</span>
                      </div>
                      <p className="theme-author">
                        作者：{item.authorUrl ? <a href={item.authorUrl} target="_blank" rel="noreferrer">{item.author}</a> : item.author}
                      </p>
                      <p className="theme-description">{item.description}</p>

                      <div className="theme-tags-row">
                        {item.tags?.map((tag) => (
                          <span key={tag} className="theme-tag">{tag}</span>
                        ))}
                      </div>

                      <div className="theme-card-actions">
                        {isDownloading ? (
                          <div className="download-progress-box">
                            <div className="progress-bar-track">
                              <div className="progress-bar-fill" style={{ width: `${downloadProgress}%` }} />
                            </div>
                            <small>{downloadProgress}%</small>
                          </div>
                        ) : isUpToDate ? (
                          <Button
                            variant="secondary"
                            onClick={() => void handleSwitchTheme(item.id)}
                          >
                            {activeThemeId === item.id ? "使用中" : "切换至该主题"}
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            onClick={() => void handleInstallFromStore(item)}
                          >
                            {installed ? "更新主题" : "获取 / 安装"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="theme-empty-store">
              <p>暂无可用的社区主题。您可以成为第一个在 GitHub 仓库提交 PR 分享主题的创作者！</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
