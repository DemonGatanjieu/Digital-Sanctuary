import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";

export interface StoredSecretPayload {
  encryptedBase64: string;
  hint: string;
  updatedAt: string;
}

export class VisionSecretStore {
  readonly #filePath: string | null;
  readonly #memoryFallback = new Map<string, { rawKey: string; hint: string }>();

  constructor(storageDirectory?: string) {
    if (storageDirectory) {
      mkdirSync(storageDirectory, { recursive: true });
      this.#filePath = join(storageDirectory, "vision_secrets.json");
    } else {
      this.#filePath = null;
    }
  }

  setApiKey(providerId: string, apiKey: string): void {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      this.deleteApiKey(providerId);
      return;
    }

    const hint = createKeyHint(trimmed);

    if (this.#canUseSafeStorage() && this.#filePath) {
      const encryptedBuffer = safeStorage.encryptString(trimmed);
      const allSecrets = this.#readSecretsFile();
      allSecrets[providerId] = {
        encryptedBase64: encryptedBuffer.toString("base64"),
        hint,
        updatedAt: new Date().toISOString()
      };
      this.#writeSecretsFile(allSecrets);
    } else {
      // Memory fallback for tests or headless environments without OS keyring
      this.#memoryFallback.set(providerId, { rawKey: trimmed, hint });
    }
  }

  getApiKey(providerId: string): string | null {
    if (this.#canUseSafeStorage() && this.#filePath) {
      const allSecrets = this.#readSecretsFile();
      const entry = allSecrets[providerId];
      if (!entry) return null;
      try {
        const buffer = Buffer.from(entry.encryptedBase64, "base64");
        return safeStorage.decryptString(buffer);
      } catch {
        return null;
      }
    }
    return this.#memoryFallback.get(providerId)?.rawKey ?? null;
  }

  hasApiKey(providerId: string): boolean {
    if (this.#canUseSafeStorage() && this.#filePath) {
      const allSecrets = this.#readSecretsFile();
      return Boolean(allSecrets[providerId]);
    }
    return this.#memoryFallback.has(providerId);
  }

  getApiKeyHint(providerId: string): string | null {
    if (this.#canUseSafeStorage() && this.#filePath) {
      const allSecrets = this.#readSecretsFile();
      return allSecrets[providerId]?.hint ?? null;
    }
    return this.#memoryFallback.get(providerId)?.hint ?? null;
  }

  deleteApiKey(providerId: string): void {
    if (this.#filePath && existsSync(this.#filePath)) {
      const allSecrets = this.#readSecretsFile();
      delete allSecrets[providerId];
      this.#writeSecretsFile(allSecrets);
    }
    this.#memoryFallback.delete(providerId);
  }

  #canUseSafeStorage(): boolean {
    try {
      return typeof safeStorage !== "undefined" && Boolean(safeStorage.isEncryptionAvailable?.());
    } catch {
      return false;
    }
  }

  #readSecretsFile(): Record<string, StoredSecretPayload> {
    if (!this.#filePath || !existsSync(this.#filePath)) return {};
    try {
      return JSON.parse(readFileSync(this.#filePath, "utf-8")) as Record<string, StoredSecretPayload>;
    } catch {
      return {};
    }
  }

  #writeSecretsFile(data: Record<string, StoredSecretPayload>): void {
    if (!this.#filePath) return;
    writeFileSync(this.#filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}

export function createKeyHint(key: string): string {
  if (key.length <= 8) return "••••";
  const prefix = key.slice(0, 3);
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}

export function redactSensitiveText(text: string, secrets: string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      redacted = redacted.replaceAll(secret, "[REDACTED_API_KEY]");
    }
  }
  return redacted;
}
