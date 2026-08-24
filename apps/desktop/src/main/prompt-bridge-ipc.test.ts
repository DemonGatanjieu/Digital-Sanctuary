import { describe, expect, it, vi } from "vitest";
import { promptWorkspacePreferenceKey } from "./prompt-bridge-ipc.js";

vi.mock("electron", () => ({ clipboard: { writeText: vi.fn() } }));

describe("prompt bridge IPC helpers", () => {
  it("isolates preferences by sanitized engine and version", () => {
    expect(promptWorkspacePreferenceKey("wd/tagger", "v3 beta")).toBe("prompt.workspace.v2:wd_tagger:v3_beta");
    expect(promptWorkspacePreferenceKey("wd-tagger", "v4")).not.toBe(promptWorkspacePreferenceKey("wd-tagger", "v3"));
  });
});
