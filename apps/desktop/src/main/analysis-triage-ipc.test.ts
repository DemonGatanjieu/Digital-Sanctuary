import type { IpcMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import { LibraryDatabase } from "@sanctuary/database";
import { buildElementFilterRules } from "@sanctuary/domain";
import { registerAnalysisIpc } from "./analysis-ipc.js";
import type { VisionClient } from "./vision-client.js";
import type { AnalysisJobScheduler } from "./analysis-job-runner.js";

describe("exploration-rule triage IPC", () => {
  it("reads current persisted rules on every request and rejects renderer-supplied rules", () => {
    const database = new LibraryDatabase(":memory:");
    const handlers = new Map<string, (...args: any[]) => any>();
    const ipc = { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) } as unknown as IpcMain;
    try {
      registerAnalysisIpc(ipc, database, { engine: "test", engineVersion: "1" } as VisionClient, {} as AnalysisJobScheduler);
      const query = handlers.get("analysis:triage-explore-rules")!;
      expect(query(null, { type: "all" }).ruleNames).toContain("血腥");
      database.saveElementFilterSetting({ groupId: "blood", enabled: false, minimumConfidence: 0.8 });
      expect(query(null, { type: "all" }).ruleNames).not.toContain("血腥");
      expect(() => query(null, { rules: [], tags: ["blood"] })).toThrow("无效的整理范围");
      expect(database.listAnalysisJobs()).toEqual([]);
    } finally { database.close(); }
  });

  it("uses the supplied exploration provider and the active model identity", () => {
    const database = new LibraryDatabase(":memory:");
    const handlers = new Map<string, (...args: any[]) => any>();
    const ipc = { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) } as unknown as IpcMain;
    const queryStore = vi.spyOn(database, "queryWorksByFilterRules");
    const rules = buildElementFilterRules([], [], { blood: 0.9 });
    try {
      registerAnalysisIpc(ipc, database, { engine: "active", engineVersion: "2" } as VisionClient, {} as AnalysisJobScheduler,
        undefined, undefined, () => rules);
      handlers.get("analysis:triage-explore-rules")!(null, { type: "selected", workIds: [] });
      expect(queryStore).toHaveBeenCalledWith(rules, { type: "selected", workIds: [] }, { engine: "active", engineVersion: "2" });
      expect(rules.find((rule) => rule.label === "blood")?.minimumConfidence).toBe(0.9);
    } finally { database.close(); }
  });
});
