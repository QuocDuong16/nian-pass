import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { dependencyLabel, loadWorkspacePackages } from "./lib/cargo_dependencies.mjs";
import {
  frontendProductionFiles,
  lineNumberAt,
  projectPath,
  readRustProduction,
  rustProductionFiles,
  withoutRustTestItems,
} from "./lib/source_policy.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

function checkPattern(violations, root, path, source, pattern, message) {
  const name = projectPath(root, path);
  for (const match of source.matchAll(pattern)) {
    violations.push(`${name}:${lineNumberAt(source, match.index)}: ${message}`);
  }
}

export function runChecks(root, budget) {
  const violations = [];
  const usedExceptions = new Set();
  const frontendFiles = frontendProductionFiles(root);
  const rustFiles = rustProductionFiles(root);

  function checkBudgets(kind, files, sourceForFile) {
    const policy = budget[kind];
    for (const path of files) {
      const name = projectPath(root, path);
      const lines = sourceForFile(path).split(/\r?\n/).length;
      const exception = policy.exceptions[name];
      const maximum = exception?.maxLines ?? policy.defaultMaxLines;
      if (exception !== undefined) {
        usedExceptions.add(`${kind}:${name}`);
        if (typeof exception.reason !== "string" || exception.reason.trim() === "") {
          violations.push(`${name}: architecture exception is missing a reason`);
        }
      }
      if (lines > maximum) {
        violations.push(`${name}: ${lines} production lines exceeds its ${maximum}-line budget`);
      }
    }

    for (const [name, exception] of Object.entries(policy.exceptions)) {
      if (!usedExceptions.has(`${kind}:${name}`)) {
        violations.push(`${name}: stale or out-of-scope architecture exception`);
      }
      if (exception.maxLines <= policy.defaultMaxLines) {
        violations.push(
          `${name}: remove the exception because ${exception.maxLines} is within the default budget`,
        );
      }
      const path = resolve(root, name);
      if (usedExceptions.has(`${kind}:${name}`)) {
        const lines = sourceForFile(path).split(/\r?\n/).length;
        if (lines <= policy.defaultMaxLines) {
          violations.push(`${name}: stale exception; the file now fits the default budget`);
        }
      }
    }
  }

  checkBudgets("typescript", frontendFiles, (path) => readFileSync(path, "utf8"));
  checkBudgets("rust", rustFiles, (path) =>
    withoutRustTestItems(readFileSync(path, "utf8")),
  );

  for (const path of frontendFiles) {
    const source = readFileSync(path, "utf8");
    const name = projectPath(root, path);
    const ipcPattern = /(?:from\s+["']@tauri-apps\/api\/core["']|\binvoke\s*\()/g;
    if (name !== "apps/desktop/src/lib/desktop.ts") {
      checkPattern(
        violations,
        root,
        path,
        source,
        ipcPattern,
        "Tauri IPC is allowed only through src/lib/desktop.ts",
      );
    }
    checkPattern(
      violations,
      root,
      path,
      source,
      /\b(?:(?:window|globalThis)\s*\.\s*)?(?:localStorage|sessionStorage|indexedDB|caches)\b|\bCacheStorage\b|\bdocument\s*\.\s*cookie\b/g,
      "browser persistence is forbidden for vault UI state",
    );
  }

  for (const path of rustFiles) {
    const source = readRustProduction(path);
    const name = projectPath(root, path);
    if (name !== "apps/desktop/src-tauri/src/commands.rs") {
      checkPattern(
        violations,
        root,
        path,
        source,
        /#\s*\[\s*tauri::command\s*\]/g,
        "#[tauri::command] is confined to src-tauri/src/commands.rs",
      );
    }
    if (!name.startsWith("crates/kdbx/")) {
      checkPattern(
        violations,
        root,
        path,
        source,
        /\bkeepass::/g,
        "keepass types must remain sealed inside the kdbx crate",
      );
    }
  }

  const manifests = [
    ["apps/cli/Cargo.toml", new Set(["kdbx", "vault-core"])],
    ["apps/desktop/src-tauri/Cargo.toml", new Set(["vault-core", "vault-session"])],
    ["crates/kdbx/Cargo.toml", new Set(["vault-core"])],
    ["crates/vault-core/Cargo.toml", new Set()],
    ["crates/vault-session/Cargo.toml", new Set(["kdbx", "vault-core"])],
    ["crates/vault-sync/Cargo.toml", new Set(["kdbx", "vault-core"])],
  ];
  const workspaceCrates = new Set([
    "kdbx",
    "vault-core",
    "vault-session",
    "vault-sync",
    "nian-pass-desktop",
    "nian-pass-cli",
  ]);
  const tauriForbidden = /^(?:tauri|tauri-plugin-)/;
  const syncNetworkDependencies = new Set([
    "reqwest",
    "hyper",
    "ureq",
    "axum",
    "actix-web",
    "tokio",
    "aws-sdk-s3",
    "object_store",
  ]);
  const packagesByManifest = new Map(
    loadWorkspacePackages(root).map((pkg) => [pkg.manifestPath, pkg]),
  );
  for (const [manifestPath, allowedInternal] of manifests) {
    const pkg = packagesByManifest.get(manifestPath);
    if (pkg === undefined) {
      throw new Error(`Cargo dependency inspection omitted workspace manifest ${manifestPath}`);
    }
    for (const dependency of pkg.dependencies) {
      const actualPackage = dependency.packageName;
      const label = dependencyLabel(dependency);
      if (workspaceCrates.has(actualPackage) && !allowedInternal.has(actualPackage)) {
        violations.push(`${manifestPath}: forbidden workspace dependency on ${label}`);
      }
      if (
        manifestPath.startsWith("crates/") &&
        manifestPath !== "crates/kdbx/Cargo.toml" &&
        actualPackage === "keepass"
      ) {
        violations.push(
          `${manifestPath}: forbidden dependency ${label}: keepass is confined to crates/kdbx`,
        );
      }
      if (manifestPath.startsWith("crates/") && tauriForbidden.test(actualPackage)) {
        violations.push(
          `${manifestPath}: forbidden dependency ${label}: core crates must not depend on Tauri`,
        );
      }
      if (
        manifestPath === "crates/vault-sync/Cargo.toml" &&
        syncNetworkDependencies.has(actualPackage)
      ) {
        violations.push(
          `${manifestPath}: vault-sync must remain transport-independent (${label})`,
        );
      }
    }
  }

  const secretTypes = ["SecretString", "KdbxDocument", "VaultSession"];
  for (const path of rustFiles) {
    const source = readRustProduction(path);
    for (const type of secretTypes) {
      const declaration = new RegExp(
        String.raw`((?:^[ \t]*#\[[^\n]*\][ \t]*\n){0,8})^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(?:struct|enum)[ \t]+${type}\b`,
        "gm",
      );
      for (const match of source.matchAll(declaration)) {
        if (/\bSerialize\b/.test(match[1])) {
          violations.push(
            `${projectPath(root, path)}:${lineNumberAt(source, match.index)}: ${type} must not derive Serialize`,
          );
        }
      }
      const serializeImpl = new RegExp(
        String.raw`\bimpl(?:\s*<[^>]*>)?\s+(?:serde::)?Serialize\s+for\s+${type}\b`,
        "g",
      );
      checkPattern(
        violations,
        root,
        path,
        source,
        serializeImpl,
        `${type} must not implement Serialize`,
      );
    }
  }

  return violations;
}

function main() {
  try {
    const budget = JSON.parse(
      readFileSync(resolve(repositoryRoot, "scripts/architecture-budget.json"), "utf8"),
    );
    const violations = runChecks(repositoryRoot, budget);
    if (violations.length === 0) {
      process.stdout.write("Architecture guard passed.\n");
      return;
    }
    process.stderr.write(
      `Architecture guard failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Architecture guard failed:\n- ${message}\n`);
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
