import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const mobileDevHost = loadEnv(mode, ".", "")["TAURI_DEV_HOST"];
  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      host: mobileDevHost ?? "127.0.0.1",
      port: 1420,
      strictPort: true,
      ...(mobileDevHost === undefined
        ? {}
        : {
            hmr: {
              protocol: "ws" as const,
              host: mobileDevHost,
              port: 1421,
            },
          }),
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      css: true,
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/**/*.d.ts"],
        thresholds: {
          statements: 65,
          branches: 60,
          functions: 63,
          lines: 64,
        },
      },
    },
  };
});
