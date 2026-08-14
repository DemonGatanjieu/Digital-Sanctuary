import { describe, expect, it } from "vitest";
import {
  VisionSecretStore,
  createKeyHint,
  redactSensitiveText
} from "./vision-secret-store.js";

describe("VisionSecretStore", () => {
  it("stores, retrieves, checks, and deletes API keys in memory fallback", () => {
    const store = new VisionSecretStore();
    expect(store.hasApiKey("openai")).toBe(false);
    expect(store.getApiKey("openai")).toBeNull();
    expect(store.getApiKeyHint("openai")).toBeNull();

    store.setApiKey("openai", "sk-proj-1234567890abcdef");
    expect(store.hasApiKey("openai")).toBe(true);
    expect(store.getApiKey("openai")).toBe("sk-proj-1234567890abcdef");
    expect(store.getApiKeyHint("openai")).toBe("sk-...cdef");

    store.deleteApiKey("openai");
    expect(store.hasApiKey("openai")).toBe(false);
    expect(store.getApiKey("openai")).toBeNull();
  });

  it("creates safe masked hints for various key lengths", () => {
    expect(createKeyHint("short")).toBe("••••");
    expect(createKeyHint("12345678")).toBe("••••");
    expect(createKeyHint("sk-openai-token-9999")).toBe("sk-...9999");
  });

  it("redacts sensitive keys from error logs and diagnostic strings", () => {
    const secret = "sk-secret-token-abcdef";
    const log = `Request to https://api.openai.com failed with authorization: Bearer ${secret}`;
    const clean = redactSensitiveText(log, [secret]);
    expect(clean).toBe("Request to https://api.openai.com failed with authorization: Bearer [REDACTED_API_KEY]");
    expect(clean.includes(secret)).toBe(false);
  });
});
