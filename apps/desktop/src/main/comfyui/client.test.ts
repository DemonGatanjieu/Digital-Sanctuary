import { describe, expect, it } from "vitest";
import { ComfyUiClient, normalizeLoopbackComfyUrl } from "./client.js";

describe("ComfyUI local client", () => {
  it("allows loopback only", () => {
    expect(normalizeLoopbackComfyUrl("http://127.0.0.1:8188/")).toBe("http://127.0.0.1:8188");
    expect(normalizeLoopbackComfyUrl("http://localhost:8188")).toBe("http://localhost:8188");
    expect(() => normalizeLoopbackComfyUrl("https://example.com")).toThrow(/本机/);
    expect(() => normalizeLoopbackComfyUrl("http://127.0.0.1:8188/api")).toThrow(/路径/);
  });

  it("runs a bounded mock connection, queue and history flow", async () => {
    const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/system_stats")) return Response.json({ system: {}, devices: [] });
      if (url.endsWith("/prompt")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ client_id: "client-1" });
        return Response.json({ prompt_id: "prompt-1" });
      }
      if (url.endsWith("/history/prompt-1")) return Response.json({
        "prompt-1": {
          status: { status_str: "success", completed: true },
          outputs: { "9": { images: [{ filename: "result.png", subfolder: "", type: "output" }] } }
        }
      });
      return new Response("missing", { status: 404 });
    };
    const client = new ComfyUiClient("http://127.0.0.1:8188", fetchMock as typeof fetch);
    await expect(client.testConnection()).resolves.toMatchObject({ success: true });
    await expect(client.queuePrompt({ "1": {} }, "client-1")).resolves.toBe("prompt-1");
    await expect(client.getHistory("prompt-1")).resolves.toMatchObject({
      complete: true,
      images: [{ filename: "result.png", subfolder: "", type: "output" }]
    });
  });
});
