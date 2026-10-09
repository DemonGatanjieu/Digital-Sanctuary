import { describe, expect, it, vi } from "vitest";
import { AsyncTaskGate } from "../shared/bounded-concurrency.js";
import { PixivApiClient, PixivBatchAbortError, pixivRetryDelay } from "./pixiv-api";

function response(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function client(responses: Array<Response | Error>) {
  const queue = [...responses];
  const session = { fetch: vi.fn(async () => { const next = queue.shift(); if (next instanceof Error) throw next; return next!; }) };
  const progress: string[] = [];
  const sleep = vi.fn(async () => undefined);
  const api = new PixivApiClient(new AsyncTaskGate(1), (update) => { if (update.message) progress.push(update.message); }, sleep, 0);
  return { api, session, progress, sleep };
}

describe("Pixiv API client", () => {
  it("retries rate limits with the server's delay, reports progress, then returns JSON", async () => {
    const { api, session, progress, sleep } = client([response(429, {}, { "retry-after": "12" }), response(200, { ok: true })]);
    await expect(api.fetchJson(session, "https://www.pixiv.net/ajax/x", "https://www.pixiv.net/")).resolves.toEqual({ ok: true });
    expect(session.fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(12_000);
    expect(progress[0]).toContain("频率限制");
  });

  it("stops the whole batch after bounded retries or a lost login", async () => {
    const network = client([new Error("offline"), new Error("offline"), new Error("offline")]);
    await expect(network.api.fetchJson(network.session, "u", "r")).rejects.toBeInstanceOf(PixivBatchAbortError);
    expect(network.session.fetch).toHaveBeenCalledTimes(3);
    const login = client([response(401)]);
    await expect(login.api.fetchJson(login.session, "u", "r")).rejects.toThrow("登录会话已失效");
  });

  it("fails a single work, not the batch, when it is forbidden", async () => {
    const { api, session } = client([response(403)]);
    const failure = await api.fetchJson(session, "u", "r").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PixivBatchAbortError);
  });

  it("caps retry delays and falls back when no header is given", () => {
    expect(pixivRetryDelay(null, 0)).toBe(5_000);
    expect(pixivRetryDelay(null, 1)).toBe(15_000);
    expect(pixivRetryDelay(response(429, {}, { "retry-after": "999" }), 0)).toBe(30_000);
  });
});
