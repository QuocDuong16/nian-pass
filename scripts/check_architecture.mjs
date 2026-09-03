import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  dependencyLabel,
  loadWorkspacePackages,
} from "./lib/cargo_dependencies.mjs";
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
        if (
          typeof exception.reason !== "string" ||
          exception.reason.trim() === ""
        ) {
          violations.push(
            `${name}: architecture exception is missing a reason`,
          );
        }
      }
      if (lines > maximum) {
        violations.push(
          `${name}: ${lines} production lines exceeds its ${maximum}-line budget`,
        );
      }
    }

    for (const [name, exception] of Object.entries(policy.exceptions)) {
      if (!usedExceptions.has(`${kind}:${name}`)) {
        violations.push(
          `${name}: stale or out-of-scope architecture exception`,
        );
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
          violations.push(
            `${name}: stale exception; the file now fits the default budget`,
          );
        }
      }
    }
  }

  checkBudgets("typescript", frontendFiles, (path) =>
    readFileSync(path, "utf8"),
  );
  checkBudgets("rust", rustFiles, (path) =>
    withoutRustTestItems(readFileSync(path, "utf8")),
  );

  for (const path of frontendFiles) {
    const source = readFileSync(path, "utf8");
    const name = projectPath(root, path);
    const ipcPattern =
      /(?:from\s+["']@tauri-apps\/api\/core["']|\binvoke\s*\()/g;
    if (
      name !== "apps/desktop/src/lib/desktop.ts" &&
      name !== "apps/desktop/src/lib/mobile.ts" &&
      name !== "apps/desktop/src/lib/browser-approval.ts"
    ) {
      checkPattern(
        violations,
        root,
        path,
        source,
        ipcPattern,
        "Tauri IPC is allowed only through reviewed src/lib adapters",
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
    if (
      name !== "apps/desktop/src-tauri/src/commands.rs" &&
      name !== "apps/desktop/src-tauri/src/commands/sync.rs" &&
      name !== "apps/desktop/src-tauri/src/mobile/commands.rs" &&
      name !== "apps/desktop/src-tauri/src/mobile/autofill_commands.rs" &&
      name !== "apps/desktop/src-tauri/src/mobile/security_commands.rs" &&
      name !== "apps/desktop/src-tauri/src/mobile/ios_commands.rs"
    ) {
      checkPattern(
        violations,
        root,
        path,
        source,
        /#\s*\[\s*tauri::command\s*\]/g,
        "#[tauri::command] is confined to reviewed command modules",
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
    [
      "apps/desktop/src-tauri/Cargo.toml",
      new Set([
        "browser-native-protocol",
        "credential-provider-core",
        "kdbx",
        "sync-engine",
        "sync-provider-core",
        "sync-provider-s3",
        "sync-provider-webdav",
        "vault-core",
        "vault-session",
      ]),
    ],
    [
      "apps/browser-native-host/Cargo.toml",
      new Set(["browser-native-protocol"]),
    ],
    ["crates/browser-native-protocol/Cargo.toml", new Set()],
    [
      "crates/credential-provider-core/Cargo.toml",
      new Set(["kdbx", "vault-core"]),
    ],
    [
      "crates/ios-credential-ffi/Cargo.toml",
      new Set(["credential-provider-core", "kdbx", "vault-core"]),
    ],
    ["crates/kdbx/Cargo.toml", new Set(["vault-core"])],
    [
      "crates/sync-engine/Cargo.toml",
      new Set(["kdbx", "sync-provider-core", "vault-core", "vault-sync"]),
    ],
    ["crates/sync-provider-core/Cargo.toml", new Set()],
    [
      "crates/sync-provider-s3/Cargo.toml",
      new Set(["sync-provider-core", "vault-core"]),
    ],
    [
      "crates/sync-provider-webdav/Cargo.toml",
      new Set(["sync-provider-core", "vault-core"]),
    ],
    ["crates/vault-core/Cargo.toml", new Set()],
    [
      "crates/vault-session/Cargo.toml",
      new Set(["kdbx", "vault-core", "windows-safe-replace"]),
    ],
    ["crates/vault-sync/Cargo.toml", new Set(["kdbx", "vault-core"])],
    ["crates/windows-safe-replace/Cargo.toml", new Set()],
  ];
  const workspaceCrates = new Set([
    "kdbx",
    "browser-native-protocol",
    "credential-provider-core",
    "ios-credential-ffi",
    "sync-engine",
    "sync-provider-core",
    "sync-provider-s3",
    "sync-provider-webdav",
    "vault-core",
    "vault-session",
    "vault-sync",
    "windows-safe-replace",
    "nian-pass-desktop",
    "nian-pass-browser-host",
    "nian-pass-cli",
  ]);

  const rootManifest = readFileSync(resolve(root, "Cargo.toml"), "utf8");
  const ffiManifest = readFileSync(
    resolve(root, "crates/ios-credential-ffi/Cargo.toml"),
    "utf8",
  );
  const windowsReplaceManifestPath = resolve(
    root,
    "crates/windows-safe-replace/Cargo.toml",
  );
  const windowsReplaceManifest = existsSync(windowsReplaceManifestPath)
    ? readFileSync(windowsReplaceManifestPath, "utf8")
    : null;
  if (!/unsafe_code\s*=\s*"forbid"/.test(rootManifest)) {
    violations.push("Cargo.toml: workspace unsafe_code must remain forbid");
  }
  if (
    !/unsafe_code\s*=\s*"allow"/.test(ffiManifest) ||
    !/unsafe_op_in_unsafe_fn\s*=\s*"deny"/.test(ffiManifest)
  ) {
    violations.push(
      "ios-credential-ffi must isolate and deny implicit unsafe operations",
    );
  }
  if (
    windowsReplaceManifest !== null &&
    (!/unsafe_code\s*=\s*"allow"/.test(windowsReplaceManifest) ||
      !/unsafe_op_in_unsafe_fn\s*=\s*"deny"/.test(windowsReplaceManifest))
  ) {
    violations.push(
      "windows-safe-replace must isolate and deny implicit unsafe operations",
    );
  }
  for (const path of rustFiles) {
    const source = readRustProduction(path);
    const name = projectPath(root, path);
    if (
      name === "crates/ios-credential-ffi/src/ffi.rs" ||
      name === "crates/windows-safe-replace/src/lib.rs"
    )
      continue;
    checkPattern(
      violations,
      root,
      path,
      source,
      /\bunsafe\s*(?:\{|fn\b|extern\b)/g,
      "unsafe Rust is confined to reviewed native FFI boundary modules",
    );
  }
  const windowsReplaceSourcePath = resolve(
    root,
    "crates/windows-safe-replace/src/lib.rs",
  );
  if (existsSync(windowsReplaceSourcePath)) {
    const windowsReplaceSource = readFileSync(windowsReplaceSourcePath, "utf8");
    if (
      !/ReplaceFileW/.test(windowsReplaceSource) ||
      /REPLACEFILE_IGNORE_(?:ACL|MERGE)_ERRORS/.test(windowsReplaceSource)
    ) {
      violations.push(
        "windows-safe-replace must use ReplaceFileW without ignore-ACL/merge flags",
      );
    }
  }
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
      if (!existsSync(resolve(root, manifestPath))) {
        continue;
      }
      throw new Error(
        `Cargo dependency inspection omitted workspace manifest ${manifestPath}`,
      );
    }
    for (const dependency of pkg.dependencies) {
      const actualPackage = dependency.packageName;
      const label = dependencyLabel(dependency);
      if (
        workspaceCrates.has(actualPackage) &&
        !allowedInternal.has(actualPackage)
      ) {
        violations.push(
          `${manifestPath}: forbidden workspace dependency on ${label}`,
        );
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
      if (
        manifestPath.startsWith("crates/") &&
        tauriForbidden.test(actualPackage)
      ) {
        violations.push(
          `${manifestPath}: forbidden dependency ${label}: core crates must not depend on Tauri`,
        );
      }
      if (
        (manifestPath === "crates/vault-sync/Cargo.toml" ||
          manifestPath === "crates/sync-provider-core/Cargo.toml") &&
        syncNetworkDependencies.has(actualPackage)
      ) {
        violations.push(
          `${manifestPath}: provider-independent sync contracts must remain transport-independent (${label})`,
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

  const desktopSetupSource = readFileSync(
    resolve(root, "apps/desktop/src-tauri/src/lib.rs"),
    "utf8",
  );
  if (desktopSetupSource.includes("BrowserBridgeState")) {
    checkPattern(
      violations,
      root,
      resolve(root, "apps/desktop/src-tauri/src/lib.rs"),
      desktopSetupSource,
      /BrowserBridgeState::start\s*\([^)]*\)\s*\?/g,
      "optional browser bridge startup must not abort desktop setup",
    );
    if (
      !/install_app_state_with_bridge/.test(desktopSetupSource) ||
      !/app\.manage\(bridge\)/.test(desktopSetupSource)
    ) {
      violations.push(
        "apps/desktop/src-tauri/src/lib.rs: browser bridge startup must be handled locally and its availability state must always be managed",
      );
    }
  }

  return violations;
}

function main() {
  try {
    const budget = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, "scripts/architecture-budget.json"),
        "utf8",
      ),
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
