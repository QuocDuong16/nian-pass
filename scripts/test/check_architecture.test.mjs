import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runChecks } from "../check_architecture.mjs";
import { loadWorkspacePackages } from "../lib/cargo_dependencies.mjs";

const workspaceMembers = [
  "apps/cli",
  "apps/desktop/src-tauri",
  "crates/kdbx",
  "crates/vault-core",
  "crates/vault-session",
  "crates/vault-sync",
];

function write(root, name, content) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function workspaceManifest(extra = "") {
  return `[workspace]\nmembers = ${JSON.stringify(workspaceMembers)}\nexclude = ["support/tauri", "support/keepass", "support/serde_json"]\nresolver = "3"\n${extra}`;
}

function packageManifest(name, dependencies = "") {
  return `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\npublish = false\n\n${dependencies}`;
}

function supportPackage(root, name) {
  write(root, `support/${name}/Cargo.toml`, packageManifest(name));
  write(root, `support/${name}/src/lib.rs`, "pub fn support() {}\n");
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-architecture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    "Cargo.toml": workspaceManifest(),
    "apps/desktop/src/lib/desktop.ts": 'import { invoke } from "@tauri-apps/api/core";\nexport const call = invoke;\n',
    "apps/desktop/src/App.tsx": "export function App() { return null; }\n",
    "apps/cli/src/main.rs": "fn main() {}\n",
    "apps/desktop/src-tauri/src/commands.rs": "#[tauri::command]\nfn command() {}\n",
    "apps/desktop/src-tauri/src/lib.rs": "pub fn run() {}\n",
    "crates/kdbx/src/lib.rs": "pub struct KdbxDocument;\n",
    "crates/vault-core/src/lib.rs": "pub struct SecretString;\n",
    "crates/vault-session/src/lib.rs": "pub struct VaultSession;\n",
    "crates/vault-sync/src/lib.rs": "pub fn merge() {}\n",
    "apps/cli/Cargo.toml": packageManifest(
      "nian-pass-cli",
      "[dependencies]\nkdbx = { path = \"../../crates/kdbx\" }\nvault-core = { path = \"../../crates/vault-core\" }\n",
    ),
    "apps/desktop/src-tauri/Cargo.toml": packageManifest(
      "nian-pass-desktop",
      "[dependencies]\nvault-core = { path = \"../../../crates/vault-core\" }\nvault-session = { path = \"../../../crates/vault-session\" }\n",
    ),
    "crates/kdbx/Cargo.toml": packageManifest(
      "kdbx",
      "[dependencies]\nvault-core = { path = \"../vault-core\" }\n",
    ),
    "crates/vault-core/Cargo.toml": packageManifest("vault-core"),
    "crates/vault-session/Cargo.toml": packageManifest(
      "vault-session",
      "[dependencies]\nkdbx = { path = \"../kdbx\" }\nvault-core = { path = \"../vault-core\" }\n",
    ),
    "crates/vault-sync/Cargo.toml": packageManifest(
      "vault-sync",
      "[dependencies]\nkdbx = { path = \"../kdbx\" }\nvault-core = { path = \"../vault-core\" }\n",
    ),
  };
  for (const [name, content] of Object.entries(files)) {
    write(root, name, content);
  }
  return root;
}

function budget(overrides = {}) {
  return {
    typescript: { defaultMaxLines: 10, exceptions: {} },
    rust: { defaultMaxLines: 10, exceptions: {} },
    ...overrides,
  };
}

test("clean fixture permits the centralized desktop invoke adapter", (t) => {
  assert.deepEqual(runChecks(fixture(t), budget()), []);
});

test("direct invoke from a component is rejected", (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, "apps/desktop/src/App.tsx"),
    'import { invoke } from "@tauri-apps/api/core";\nexport const App = () => invoke("x");\n',
  );
  assert.match(runChecks(root, budget()).join("\n"), /IPC is allowed only/);
});

test("browser persistence is rejected", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "apps/desktop/src/App.tsx"), 'localStorage.setItem("x", "y");\n');
  assert.match(runChecks(root, budget()).join("\n"), /browser persistence/);
});

test("Tauri dependency in vault-core is rejected", (t) => {
  const root = fixture(t);
  supportPackage(root, "tauri");
  write(
    root,
    "crates/vault-core/Cargo.toml",
    packageManifest("vault-core", '[dependencies]\ntauri = { path = "../../support/tauri" }\n'),
  );
  assert.match(runChecks(root, budget()).join("\n"), /must not depend on Tauri/);
});

test("renamed Tauri dependency in vault-core is rejected by actual package name", (t) => {
  const root = fixture(t);
  supportPackage(root, "tauri");
  write(
    root,
    "crates/vault-core/Cargo.toml",
    packageManifest(
      "vault-core",
      '[dependencies]\ndesktop-runtime = { package = "tauri", path = "../../support/tauri" }\n',
    ),
  );
  assert.match(
    runChecks(root, budget()).join("\n"),
    /desktop-runtime \(package tauri\): core crates must not depend on Tauri/,
  );
});

test("renamed keepass dependency outside kdbx is rejected by actual package name", (t) => {
  const root = fixture(t);
  supportPackage(root, "keepass");
  write(
    root,
    "crates/vault-session/Cargo.toml",
    packageManifest(
      "vault-session",
      '[dependencies]\nkdbx = { path = "../kdbx" }\nvault-core = { path = "../vault-core" }\nkp = { package = "keepass", path = "../../support/keepass" }\n',
    ),
  );
  assert.match(
    runChecks(root, budget()).join("\n"),
    /kp \(package keepass\): keepass is confined to crates\/kdbx/,
  );
});

test("harmless renamed dependency is allowed", (t) => {
  const root = fixture(t);
  supportPackage(root, "serde_json");
  write(
    root,
    "crates/vault-core/Cargo.toml",
    packageManifest(
      "vault-core",
      '[dependencies]\njson = { package = "serde_json", path = "../../support/serde_json" }\n',
    ),
  );
  assert.deepEqual(runChecks(root, budget()), []);
});

test("target-specific renamed Tauri dependency is rejected on every host", (t) => {
  const root = fixture(t);
  supportPackage(root, "tauri");
  write(
    root,
    "crates/vault-core/Cargo.toml",
    packageManifest(
      "vault-core",
      `[target.'cfg(windows)'.dependencies]\ndesktop-runtime = { package = "tauri", path = "../../support/tauri" }\n`,
    ),
  );
  const dependency = loadWorkspacePackages(root)
    .find((pkg) => pkg.packageName === "vault-core")
    ?.dependencies.find((item) => item.localName === "desktop-runtime");
  assert.equal(dependency?.packageName, "tauri");
  assert.equal(dependency?.kind, "normal");
  assert.equal(dependency?.target, "cfg(windows)");
  assert.match(runChecks(root, budget()).join("\n"), /desktop-runtime \(package tauri\)/);
});

test("workspace-inherited renamed Tauri dependency resolves to the actual package", (t) => {
  const root = fixture(t);
  supportPackage(root, "tauri");
  write(
    root,
    "Cargo.toml",
    workspaceManifest(
      '[workspace.dependencies]\ndesktop-runtime = { package = "tauri", path = "support/tauri" }\n',
    ),
  );
  write(
    root,
    "crates/vault-core/Cargo.toml",
    packageManifest("vault-core", "[dependencies]\ndesktop-runtime.workspace = true\n"),
  );
  const dependency = loadWorkspacePackages(root)
    .find((pkg) => pkg.packageName === "vault-core")
    ?.dependencies.find((item) => item.localName === "desktop-runtime");
  assert.equal(dependency?.packageName, "tauri");
  assert.equal(dependency?.source, "path");
  assert.match(runChecks(root, budget()).join("\n"), /desktop-runtime \(package tauri\)/);
});

test("production file over the default line budget is rejected", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "apps/desktop/src/App.tsx"), "x\n".repeat(12));
  assert.match(runChecks(root, budget()).join("\n"), /exceeds its 10-line budget/);
});

test("stale exact-path exception is rejected", (t) => {
  const root = fixture(t);
  const policy = budget({
    typescript: {
      defaultMaxLines: 10,
      exceptions: {
        "apps/desktop/src/missing.ts": { maxLines: 20, reason: "legacy file" },
      },
    },
  });
  assert.match(runChecks(root, policy).join("\n"), /stale or out-of-scope/);
});

test("cfg(test) modules do not consume Rust production line budget", (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, "crates/vault-core/src/lib.rs"),
    "pub struct SecretString;\n#[cfg(test)]\nmod tests {\n" + "fn test_only() {}\n".repeat(20) + "}\n",
  );
  assert.deepEqual(runChecks(root, budget()), []);
});

test("Serialize on a known secret-bearing type is rejected", (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, "crates/vault-core/src/lib.rs"),
    "#[derive(serde::Serialize)]\npub struct SecretString;\n",
  );
  assert.match(runChecks(root, budget()).join("\n"), /SecretString must not derive Serialize/);
});
