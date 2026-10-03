import type { ElementFilterSetting, ElementBlacklistGroup, InstalledModelView } from "@sanctuary/domain";

export function filterSettingFor(group: Pick<ElementBlacklistGroup, "id" | "defaultThreshold">, settings: readonly ElementFilterSetting[]): ElementFilterSetting {
  return settings.find((setting) => setting.groupId === group.id) ?? {
    groupId: group.id, enabled: true, minimumConfidence: group.defaultThreshold
  };
}

export function explorationModels(models: readonly InstalledModelView[]): InstalledModelView[] {
  return models.filter((model) => model.capability === "element_tagging" && model.availability !== "runtime_pending");
}

/** Serialize complete-list replies; a second control must not overwrite a pending change. */
export class FilterChangeGate {
  private pending = false;
  get busy(): boolean { return this.pending; }
  async run<T>(operation: () => Promise<T>): Promise<{ accepted: false } | { accepted: true; value: T }> {
    if (this.pending) return { accepted: false };
    this.pending = true;
    try { return { accepted: true, value: await operation() }; }
    finally { this.pending = false; }
  }
}
