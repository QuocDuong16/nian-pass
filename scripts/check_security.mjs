import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  frontendProductionFiles,
  lineNumberAt,
  projectPath,
  readRustProduction,
  rustProductionFiles,
} from "./lib/source_policy.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const forbiddenPlugins = new Set([
  "tauri-plugin-shell",
  "tauri-plugin-http",
  "tauri-plugin-clipboard",
  "tauri-plugin-clipboard-manager",
  "tauri-plugin-process",
  "tauri-plugin-fs",
  "tauri-plugin-updater",
  "@tauri-apps/plugin-shell",
  "@tauri-apps/plugin-http",
  "@tauri-apps/plugin-clipboard-manager",
  "@tauri-apps/plugin-process",
  "@tauri-apps/plugin-fs",
  "@tauri-apps/plugin-updater",
]);

function reportMatches(violations, root, path, source, pattern, message) {
  const name = projectPath(root, path);
  for (const match of source.matchAll(pattern)) {
    violations.push(`${name}:${lineNumberAt(source, match.index)}: ${message}`);
  }
}

function dependencyKeys(manifest) {
  const keys = new Set();
  let inDependencies = false;
  for (const line of manifest.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1];
    if (section !== undefined) {
      inDependencies = section.includes("dependencies");
      continue;
    }
    if (!inDependencies) continue;
    const key = line.match(/^\s*["']?([@A-Za-z0-9_\/-]+)["']?\s*=/)?.[1];
    if (key !== undefined) keys.add(key);
  }
  return keys;
}

function cspDirectives(csp) {
  const directives = new Map();
  for (const segment of csp.split(";")) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const [name, ...values] = tokens;
    if (name !== undefined) directives.set(name, new Set(values));
  }
  return directives;
}

export function runChecks(root) {
  const violations = [];

  const frontendRules = [
    [/\bconsole\s*\./g, "production frontend console logging is forbidden"],
    [
      /\b(?:(?:window|globalThis)\s*\.\s*)?(?:localStorage|sessionStorage|indexedDB|caches)\b|\bCacheStorage\b|\bdocument\s*\.\s*cookie\b/g,
      "browser persistence APIs are forbidden for vault UI state",
    ],
    [/\bdangerouslySetInnerHTML\b/g, "dangerouslySetInnerHTML is forbidden"],
    [/\bdocument\s*\.\s*write\s*\(/g, "document.write is forbidden"],
    [/\beval\s*\(/g, "eval is forbidden"],
    [/(?:\bnew\s+Function\s*\(|\bFunction\s*\()/g, "Function constructors are forbidden"],
    [/https?:\/\//g, "runtime remote URLs/assets are forbidden in production frontend source"],
    [/@tauri-apps\/plugin-/g, "Tauri JavaScript plugins are not approved for the M4.Q frontend"],
  ];
  for (const path of frontendProductionFiles(root)) {
    const source = readFileSync(path, "utf8");
    for (const [pattern, message] of frontendRules) {
      reportMatches(violations, root, path, source, pattern, message);
    }
  }

  for (const path of rustProductionFiles(root)) {
    const source = readRustProduction(path);
    const name = projectPath(root, path);
    reportMatches(
      violations,
      root,
      path,
      source,
      /\b(?:dbg|todo|unimplemented)!\s*\(/g,
      "dbg!/todo!/unimplemented! are forbidden in production Rust",
    );
    if (name !== "apps/cli/src/main.rs") {
      reportMatches(
        violations,
        root,
        path,
        source,
        /\b(?:println|eprintln)!\s*\(/g,
        "stdout/stderr macros are allowed only for explicit CLI user output",
      );
    }
    for (const match of source.matchAll(/\btauri_plugin_([A-Za-z0-9_]+)/g)) {
      if (match[1] !== "dialog") {
        violations.push(
          `${name}:${lineNumberAt(source, match.index)}: Tauri plugin ${match[1]} is not approved for M4.Q`,
        );
      }
    }
  }

  const desktopPackage = JSON.parse(
    readFileSync(resolve(root, "apps/desktop/package.json"), "utf8"),
  );
  for (const group of [desktopPackage.dependencies, desktopPackage.devDependencies]) {
    for (const dependency of Object.keys(group ?? {})) {
      if (forbiddenPlugins.has(dependency)) {
        violations.push(`apps/desktop/package.json: forbidden current-milestone plugin ${dependency}`);
      }
    }
  }
  const rustManifests = [
    "Cargo.toml",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/cli/Cargo.toml",
    "crates/kdbx/Cargo.toml",
    "crates/vault-core/Cargo.toml",
    "crates/vault-session/Cargo.toml",
    "crates/vault-sync/Cargo.toml",
  ];
  for (const manifest of rustManifests) {
    for (const dependency of dependencyKeys(readFileSync(resolve(root, manifest), "utf8"))) {
      if (forbiddenPlugins.has(dependency)) {
        violations.push(`${manifest}: forbidden current-milestone plugin ${dependency}`);
      }
    }
  }

  const capabilityDirectory = resolve(root, "apps/desktop/src-tauri/capabilities");
  const allowedPermissions = new Set(["core:default"]);
  for (const file of readdirSync(capabilityDirectory).filter((name) => name.endsWith(".json"))) {
    const relativeName = `apps/desktop/src-tauri/capabilities/${file}`;
    const capability = JSON.parse(readFileSync(resolve(capabilityDirectory, file), "utf8"));
    if (!Array.isArray(capability.permissions)) {
      violations.push(`${relativeName}: permissions must be an explicit array`);
      continue;
    }
    for (const permission of capability.permissions) {
      if (typeof permission !== "string" || !allowedPermissions.has(permission)) {
        violations.push(`${relativeName}: permission is not approved for M4.Q: ${String(permission)}`);
      }
    }
  }

  const tauriConfigPath = resolve(root, "apps/desktop/src-tauri/tauri.conf.json");
  if (!existsSync(tauriConfigPath)) {
    violations.push("apps/desktop/src-tauri/tauri.conf.json: missing Tauri configuration");
  } else {
    const config = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
    const csp = config?.app?.security?.csp;
    if (typeof csp !== "string" || csp.trim() === "") {
      violations.push("apps/desktop/src-tauri/tauri.conf.json: production CSP must be explicit");
    } else {
      const directives = cspDirectives(csp);
      const script = directives.get("script-src") ?? new Set();
      const defaults = directives.get("default-src") ?? new Set();
      const connect = directives.get("connect-src") ?? new Set();
      if (script.has("'unsafe-eval'")) violations.push("Tauri CSP: script-src must not allow unsafe-eval");
      if (script.has("*")) violations.push("Tauri CSP: script-src must not allow *");
      if (defaults.has("*")) violations.push("Tauri CSP: default-src must not allow *");
      if (connect.has("*") || connect.has("https:")) {
        violations.push("Tauri CSP: connect-src must not allow arbitrary remote HTTPS origins");
      }
    }
  }

  return violations;
}

function main() {
  const violations = runChecks(repositoryRoot);
  if (violations.length > 0) {
    process.stderr.write(
      `Security policy check failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("Security policy check passed.\n");
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();

export { cspDirectives, dependencyKeys };
