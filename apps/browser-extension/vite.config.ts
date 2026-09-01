import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

import { generateManifest, type BrowserTarget } from "./src/manifest.ts";

const entries = new Set(["background", "content", "popup"]);
const targets = new Set<BrowserTarget>(["chromium", "firefox"]);

export default defineConfig(({ mode }) => {
  const [rawTarget, rawEntry] = mode.split("-");
  const target = targets.has(rawTarget as BrowserTarget)
    ? (rawTarget as BrowserTarget)
    : "chromium";
  const entry = entries.has(rawEntry ?? "")
    ? (rawEntry ?? "background")
    : "background";
  const outDir = resolve(import.meta.dirname, "dist", target);

  return {
    build: {
      emptyOutDir: entry === "background",
      outDir,
      cssCodeSplit: false,
      lib: {
        entry: resolve(import.meta.dirname, "src", `${entry}.ts`),
        formats: ["iife"],
        name: `NianPass${entry}`,
        fileName: () => `${entry}.js`,
        cssFileName: "popup",
      },
    },
    plugins: [
      {
        name: "nian-pass-extension-shell",
        closeBundle() {
          if (entry !== "popup") return;
          mkdirSync(resolve(outDir, "icons"), { recursive: true });
          copyFileSync(
            resolve(import.meta.dirname, "../desktop/src-tauri/icons/icon.png"),
            resolve(outDir, "icons/icon.png"),
          );
          writeFileSync(
            resolve(outDir, "manifest.json"),
            `${JSON.stringify(generateManifest(target), null, 2)}\n`,
          );
          writeFileSync(
            resolve(outDir, "popup.html"),
            '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nian Pass</title><link rel="stylesheet" href="popup.css"></head><body><main><h1>Nian Pass</h1><p id="site">Current site</p><p id="permission">Waiting</p><p id="detection">Waiting for page detection</p><button id="enable" type="button">Enable on this site</button><button id="disable" type="button">Disable on this site</button><hr><p id="desktop">Disconnected</p><button id="connect" type="button">Connect to Nian Pass</button><div id="candidates" aria-label="Matching credentials"></div><p id="error" role="status"></p></main><script src="popup.js"></script></body></html>\n',
          );
        },
      },
    ],
    test: {
      environment: "jsdom",
      globals: true,
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        include: ["src/**/*.ts"],
        exclude: ["src/**/*.test.ts"],
        thresholds: {
          statements: 85,
          branches: 80,
          functions: 85,
          lines: 85,
        },
      },
    },
  };
});
