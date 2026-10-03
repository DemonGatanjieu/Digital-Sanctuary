import { describe, expect, it } from "vitest";
import { ELEMENT_BLACKLIST_GROUPS, type InstalledModelView } from "@sanctuary/domain";
import { explorationModels, FilterChangeGate, filterSettingFor } from "./explore-protection-model";

describe("exploration protection controls", () => {
  it("keeps explicitly tuned or disabled rules instead of replacing them with defaults", () => {
    const group = ELEMENT_BLACKLIST_GROUPS[0]!;
    const stored = { groupId: group.id, enabled: false, minimumConfidence: .85 };
    expect(filterSettingFor(group, [stored])).toEqual(stored);
    expect(filterSettingFor(group, [])).toEqual({ groupId: group.id, enabled: true, minimumConfidence: group.defaultThreshold });
  });
  it("offers only usable exploration engines, including optional installs", () => {
    const models = [
      { id: "built-in", capability: "element_tagging", availability: "ready", installed: true },
      { id: "optional", capability: "element_tagging", availability: "ready", installed: false },
      { id: "pending", capability: "element_tagging", availability: "runtime_pending" },
      { id: "critic", capability: "art_critic", availability: "ready" }
    ] as InstalledModelView[];
    expect(explorationModels(models).map((model) => model.id)).toEqual(["built-in", "optional"]);
  });
  it("rejects a second mutation while a complete-list reply is pending", async () => {
    const gate = new FilterChangeGate();
    let finish!: (value: string[]) => void;
    const first = gate.run(() => new Promise<string[]>((resolve) => { finish = resolve; }));
    let secondRan = false;
    expect(await gate.run(async () => { secondRan = true; })).toEqual({ accepted: false });
    expect(secondRan).toBe(false);
    finish(["saved"]);
    expect(await first).toEqual({ accepted: true, value: ["saved"] });
    expect(gate.busy).toBe(false);
  });
  it("releases the gate after a failure so the unchanged rule can be retried", async () => {
    const gate = new FilterChangeGate();
    await expect(gate.run(async () => { throw new Error("storage failed"); })).rejects.toThrow("storage failed");
    expect(gate.busy).toBe(false);
    expect(await gate.run(async () => "saved")).toEqual({ accepted: true, value: "saved" });
  });
});
