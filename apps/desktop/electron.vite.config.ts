import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));

const workspacePackages = [
  "@sanctuary/database",
  "@sanctuary/domain",
  "@sanctuary/protocol"
];

const alias = {
  "@sanctuary/database": fileURLToPath(
    new URL("../../packages/database/dist/index.js", import.meta.url)
  ),
  "@sanctuary/domain": fileURLToPath(
    new URL("../../packages/domain/dist/index.js", import.meta.url)
  ),
  "@sanctuary/protocol": fileURLToPath(
    new URL("../../packages/protocol/dist/index.js", import.meta.url)
  )
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    resolve: { alias },
    build: {
      lib: { entry: resolve(desktopRoot, "src/main/index.ts") },
      outDir: resolve(desktopRoot, "out/main")
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    resolve: { alias },
    build: {
      lib: {
        entry: {
          index: resolve(desktopRoot, "src/preload/index.ts"),
          explore: resolve(desktopRoot, "src/preload/explore.ts")
        }
      },
      outDir: resolve(desktopRoot, "out/preload"),
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias },
    root: resolve(desktopRoot, "src/renderer"),
    build: {
      outDir: resolve(desktopRoot, "out/renderer"),
      rollupOptions: {
        input: resolve(desktopRoot, "src/renderer/index.html")
      }
    }
  }
});
