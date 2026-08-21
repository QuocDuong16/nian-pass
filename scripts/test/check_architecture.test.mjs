import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runChecks } from "../check_architecture.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-architecture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    "apps/desktop/src/lib/desktop.ts": 'import { invoke } from "@tauri-apps/api/core";\nexport const call = invoke;\n',
    "apps/desktop/src/App.tsx": "export function App() { return null; }\n",
    "apps/cli/src/main.rs": "fn main() {}\n",
    "apps/desktop/src-tauri/src/commands.rs": "#[tauri::command]\nfn command() {}\n",
    "apps/desktop/src-tauri/src/lib.rs": "pub fn run() {}\n",
    "crates/kdbx/src/lib.rs": "pub struct KdbxDocument;\n",
    "crates/vault-core/src/lib.rs": "pub struct SecretString;\n",
    "crates/vault-session/src/lib.rs": "pub struct VaultSession;\n",
    "crates/vault-sync/src/lib.rs": "pub fn merge() {}\n",
    "apps/cli/Cargo.toml": "[dependencies]\nkdbx = { path = \"../../crates/kdbx\" }\nvault-core = { path = \"../../crates/vault-core\" }\n",
    "apps/desktop/src-tauri/Cargo.toml": "[dependencies]\nvault-core = { path = \"../../../crates/vault-core\" }\nvault-session = { path = \"../../../crates/vault-session\" }\n",
    "crates/kdbx/Cargo.toml": "[dependencies]\nvault-core = { path = \"../vault-core\" }\n",
    "crates/vault-core/Cargo.toml": "[dependencies]\nzeroize = \"1\"\n",
    "crates/vault-session/Cargo.toml": "[dependencies]\nkdbx = { path = \"../kdbx\" }\nvault-core = { path = \"../vault-core\" }\n",
    "crates/vault-sync/Cargo.toml": "[dependencies]\nkdbx = { path = \"../kdbx\" }\nvault-core = { path = \"../vault-core\" }\n",
  };
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
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
  writeFileSync(join(root, "crates/vault-core/Cargo.toml"), "[dependencies]\ntauri = \"2\"\n");
  assert.match(runChecks(root, budget()).join("\n"), /must not depend on Tauri/);
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
