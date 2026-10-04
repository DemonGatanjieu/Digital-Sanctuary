import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@sanctuary/domain": fileURLToPath(
        new URL("./packages/domain/src/index.ts", import.meta.url)
      ),
      "@sanctuary/protocol": fileURLToPath(
        new URL("./packages/protocol/src/index.ts", import.meta.url)
      ),
      "@sanctuary/database": fileURLToPath(
        new URL("./packages/database/src/index.ts", import.meta.url)
      )
    }
  },
  test: {
    // SQLite/file fixtures compete for Windows disk I/O when every suite gets its own worker.
    maxWorkers: 4,
    include: [
      "packages/**/src/**/*.test.{ts,tsx}",
      "services/**/src/**/*.test.{ts,tsx}",
      "apps/**/src/**/*.test.{ts,tsx}"
    ]
  }
});
