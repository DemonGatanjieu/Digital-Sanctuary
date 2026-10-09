import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_LIBRARY_PREFERENCES } from "@sanctuary/domain";
import { AppSidebar, type AppStatus } from "./AppSidebar";
import { initialExploreState } from "./ExploreView";
import { SettingsView } from "./SettingsView";
import { restoreDefaultDownloadLocation, type SettingsSection } from "./app-navigation";

const appearance = { displayProfile: "balanced", reducedMotion: false, ambientArtwork: true } as const;
const ignore = () => undefined;
const resolve = async () => undefined;

function settingsMarkup(section: SettingsSection) {
  return renderToStaticMarkup(
    <SettingsView section={section} onSectionChange={ignore} onError={ignore}
      appearance={appearance} libraryPreferences={DEFAULT_LIBRARY_PREFERENCES} error=""
      onOpenProtection={ignore} onAppearanceChange={resolve}
      onLibraryPreferencesChange={resolve} onChooseDownloadDirectory={resolve}
      onCreateBackup={async () => null} />
  );
}

function sidebarMarkup(status: AppStatus | null = null, exploreState = initialExploreState) {
  return renderToStaticMarkup(
    <AppSidebar activeView="inspiration" exploreState={exploreState}
      appearance={appearance} status={status} onOpenGallery={ignore} onViewChange={ignore}
      onOpenSettings={ignore} />
  );
}

describe("task-based navigation", () => {
  it("lists the main views on the rail and keeps home behind the brand mark", () => {
    const markup = sidebarMarkup();
    expect([...markup.matchAll(/data-nav="([^"]+)"/g)].map((match) => match[1]))
      .toEqual(["home", "gallery", "explore", "inspiration", "settings"]);
    expect(markup).toMatch(/data-nav="inspiration" aria-current="page"/);
    expect(markup).not.toContain("显示性能档位");
  });

  it("does not present a ready development probe as working exploration protection", () => {
    const markup = sidebarMarkup({ visionEngine: "filename-probe", visionProvider: "probe",
      visionReady: true, visionState: "ready", visionError: "", modelBacked: false });
    expect(markup).toContain("探索保护需检查");
    expect(markup).not.toContain("status-dot online");
  });

  it("keeps the unprotected-session warning even when the model becomes ready", () => {
    const markup = sidebarMarkup({ visionEngine: "wd-tagger", visionProvider: "CPU",
      visionReady: true, visionState: "ready", visionError: "", modelBacked: true },
      { ...initialExploreState, protectionStatus: "bypassed" });
    expect(markup).toContain("本次无保护浏览");
    expect(markup).toContain("点击进入探索恢复保护");
    expect(markup).not.toContain("status-dot online");
    expect(markup).not.toContain("探索保护已就绪");
  });

  it.each([
    ["library", "storage-preference-card"],
    ["appearance", "appearance-settings-card"],
    ["models", "model-center-page"],
    ["connections", "external-vision"]
  ] as const)("renders only the requested settings category: %s", (section, expectedClass) => {
    const markup = settingsMarkup(section);
    expect(markup).toContain(expectedClass);
    const classes = ["storage-preference-card", "appearance-settings-card", "model-center-page", "external-vision"];
    for (const otherClass of classes.filter((value) => value !== expectedClass)) {
      expect(markup).not.toContain(otherClass);
    }
    expect(markup.match(/<h1>/g)).toHaveLength(1);
  });

  it("keeps advanced forms out of initial settings and leaves protection in its task", () => {
    expect(settingsMarkup("appearance")).not.toContain("slot-select");
    expect(settingsMarkup("connections")).not.toContain("vision-model-input");
    expect(settingsMarkup("library")).not.toContain("一键迁移已有照片至此");
    expect(settingsMarkup("protection")).toContain("在探索管理浏览保护");
    expect(settingsMarkup("protection")).not.toContain("rules-grid");
    expect(settingsMarkup("models")).not.toContain("相似搜索");
    expect(settingsMarkup("models")).not.toContain("整体观感");
  });

  it("restores the download location without resetting browsing preferences", () => {
    const preferences = { ...DEFAULT_LIBRARY_PREFERENCES, defaultView: "collections" as const,
      defaultSortBy: "title" as const, defaultSortDirection: "asc" as const,
      gridDensity: "compact" as const, downloadDirectory: "F:\\Art" };
    expect(restoreDefaultDownloadLocation(preferences)).toEqual({ ...preferences, downloadDirectory: null });
    expect(preferences.downloadDirectory).toBe("F:\\Art");
  });
});
