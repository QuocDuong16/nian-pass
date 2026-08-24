import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { dependencyLabel, loadWorkspacePackages } from "./lib/cargo_dependencies.mjs";
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
const approvedCsp = new Map([
  ["default-src", new Set(["'self'"])],
  ["connect-src", new Set(["ipc:", "http://ipc.localhost"])],
  ["img-src", new Set(["'self'", "asset:", "data:"])],
  ["style-src", new Set(["'self'", "'unsafe-inline'"])],
  ["script-src", new Set(["'self'"])],
  ["object-src", new Set(["'none'"])],
  ["base-uri", new Set(["'none'"])],
  ["frame-src", new Set(["'none'"])],
]);
const normalizedKeywords = new Set([
  "'self'",
  "'none'",
  "'unsafe-inline'",
  "'unsafe-eval'",
]);

function reportMatches(violations, root, path, source, pattern, message) {
  const name = projectPath(root, path);
  for (const match of source.matchAll(pattern)) {
    violations.push(`${name}:${lineNumberAt(source, match.index)}: ${message}`);
  }
}

function javascriptDependencyPackage(localName, requirement) {
  if (typeof requirement !== "string") return localName;
  const alias = requirement.match(/^npm:((?:@[^/@\s]+\/[^@\s]+)|(?:[^@\s]+))(?:@.+)?$/);
  return alias?.[1] ?? localName;
}

function normalizeCspToken(token) {
  const lowercase = token.toLowerCase();
  return normalizedKeywords.has(lowercase) ? lowercase : token;
}

function cspDirectives(csp) {
  const directives = new Map();
  const duplicates = [];
  for (const segment of csp.split(";")) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const [rawName, ...rawValues] = tokens;
    if (rawName === undefined) continue;
    const name = rawName.toLowerCase();
    if (directives.has(name)) {
      duplicates.push(name);
      continue;
    }
    directives.set(name, new Set(rawValues.map(normalizeCspToken)));
  }
  return { directives, duplicates };
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
    [
      /\b(?:(?:window|globalThis)\s*\.\s*)?navigator\s*(?:(?:\?\.|\.)\s*clipboard\b|\[\s*["']clipboard["']\s*\])/g,
      "browser clipboard access is forbidden; use semantic Rust IPC commands",
    ],
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
      const approvedDesktopPlugin =
        name.startsWith("apps/desktop/src-tauri/") &&
        (match[1] === "dialog" || match[1] === "clipboard_manager");
      if (!approvedDesktopPlugin) {
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
    for (const [localName, requirement] of Object.entries(group ?? {})) {
      const actualPackage = javascriptDependencyPackage(localName, requirement);
      if (forbiddenPlugins.has(actualPackage)) {
        const label = localName === actualPackage ? actualPackage : `${localName} (package ${actualPackage})`;
        violations.push(`apps/desktop/package.json: forbidden current-milestone plugin ${label}`);
      }
    }
  }
  for (const pkg of loadWorkspacePackages(root)) {
    for (const dependency of pkg.dependencies) {
      if (
        dependency.packageName === "tauri-plugin-clipboard-manager" &&
        pkg.manifestPath === "apps/desktop/src-tauri/Cargo.toml"
      ) {
        continue;
      }
      if (forbiddenPlugins.has(dependency.packageName)) {
        violations.push(
          `${pkg.manifestPath}: forbidden current-milestone plugin ${dependencyLabel(dependency)}`,
        );
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
      const { directives, duplicates } = cspDirectives(csp);
      for (const directive of duplicates) {
        violations.push(`Tauri CSP: duplicate ${directive} directive is forbidden`);
      }
      for (const directive of directives.keys()) {
        if (!approvedCsp.has(directive)) {
          violations.push(`Tauri CSP: directive ${directive} is not approved for M4.Q`);
        }
      }
      for (const [directive, allowedTokens] of approvedCsp) {
        const actualTokens = directives.get(directive);
        if (actualTokens === undefined) {
          violations.push(`Tauri CSP: required directive ${directive} is missing`);
          continue;
        }
        if (actualTokens.size === 0) {
          violations.push(`Tauri CSP: ${directive} must have an explicit source list`);
          continue;
        }
        for (const token of actualTokens) {
          if (!allowedTokens.has(token)) {
            violations.push(`Tauri CSP: ${directive} token ${token} is not approved for M4.Q`);
          }
        }
      }
    }
  }

  return violations;
}

function main() {
  try {
    const violations = runChecks(repositoryRoot);
    if (violations.length === 0) {
      process.stdout.write("Security policy check passed.\n");
      return;
    }
    process.stderr.write(
      `Security policy check failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Security policy check failed:\n- ${message}\n`);
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();

export { cspDirectives, javascriptDependencyPackage };
