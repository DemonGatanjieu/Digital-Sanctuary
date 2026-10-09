import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const rendererStylesEntry = resolve(desktopRoot, "src/renderer/src/styles.css");
const rendererStylesDirectory = resolve(desktopRoot, "src/renderer/src/styles");

function rendererStylesPlugin(): Plugin {
  const publicId = "virtual:sanctuary-styles.css";
  const resolvedId = `\0${publicId}`;
  return {
    name: "sanctuary-renderer-styles",
    resolveId(id) {
      return id === publicId ? resolvedId : null;
    },
    load(id) {
      if (id !== resolvedId) return null;
      this.addWatchFile(rendererStylesEntry);
      const entry = readFileSync(rendererStylesEntry, "utf8");
      const order = entry.match(/^@layer ([\w\s,-]+);/m)?.[1];
      const modules = [...entry.matchAll(/@import "\.\/styles\/([^\"]+)" layer\(([\w-]+)\);/g)].flatMap(
        (match) => (match[1] && match[2] ? [{ name: match[1], layer: match[2] }] : []),
      );
      if (!order || modules.length === 0) {
        throw new Error("Renderer style manifest must declare its layer order and import modules");
      }
      // Each module is wrapped in its cascade layer, so newer layers win regardless of selector specificity.
      return `@layer ${order};\n` + modules
        .map(({ name, layer }) => {
          const modulePath = resolve(rendererStylesDirectory, name);
          this.addWatchFile(modulePath);
          return `@layer ${layer} {\n${readFileSync(modulePath, "utf8")}\n}\n`;
        })
        .join("");
    },
  };
}

// Production renderer policy: only bundled code runs; images come from the app, the local image protocol or data URLs.
// https: images stay allowed for user-chosen avatar URLs. Dev mode skips this so Vite's inline HMR preamble works.
const RENDERER_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' sanctuary-image: data: blob: https:",
  "media-src 'self' sanctuary-image: blob:",
  "font-src 'self' sanctuary-font: data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

function contentSecurityPolicyPlugin(): Plugin {
  return {
    name: "sanctuary-renderer-csp",
    apply: "build",
    transformIndexHtml: (html) => html.replace("<head>", `<head>
    <meta http-equiv="Content-Security-Policy" content="${RENDERER_CSP}" />`)
  };
}

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
    plugins: [rendererStylesPlugin(), contentSecurityPolicyPlugin(), react()],
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
