import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runChecks } from "../check_security.mjs";

function write(root, name, content) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-security-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "apps/desktop/src/App.tsx", "export const App = () => null;\n");
  for (const path of [
    "apps/cli/src/main.rs",
    "apps/desktop/src-tauri/src/lib.rs",
    "crates/kdbx/src/lib.rs",
    "crates/vault-core/src/lib.rs",
    "crates/vault-session/src/lib.rs",
    "crates/vault-sync/src/lib.rs",
  ]) {
    write(root, path, "pub fn safe() {}\n");
  }
  write(root, "apps/desktop/package.json", '{"dependencies":{"@tauri-apps/api":"2.11.1"}}\n');
  for (const path of [
    "Cargo.toml",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/cli/Cargo.toml",
    "crates/kdbx/Cargo.toml",
    "crates/vault-core/Cargo.toml",
    "crates/vault-session/Cargo.toml",
    "crates/vault-sync/Cargo.toml",
  ]) {
    write(root, path, "[dependencies]\nserde = \"1\"\n");
  }
  write(
    root,
    "apps/desktop/src-tauri/capabilities/main.json",
    '{"permissions":["core:default"]}\n',
  );
  write(
    root,
    "apps/desktop/src-tauri/tauri.conf.json",
    JSON.stringify({
      app: {
        security: {
          csp: "default-src 'self'; connect-src ipc: http://ipc.localhost; script-src 'self'",
        },
      },
    }),
  );
  return root;
}

test("approved capability, CSP, dependencies, and source pass", (t) => {
  assert.deepEqual(runChecks(fixture(t)), []);
});

test("browser storage and console output are rejected", (t) => {
  const root = fixture(t);
  write(root, "apps/desktop/src/App.tsx", 'console.error(localStorage.getItem("vault"));\n');
  const violations = runChecks(root).join("\n");
  assert.match(violations, /console logging/);
  assert.match(violations, /browser persistence/);
});

test("dangerous CSP directives are rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/tauri.conf.json",
    JSON.stringify({ app: { security: { csp: "default-src *; script-src 'unsafe-eval' *; connect-src https:" } } }),
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /unsafe-eval/);
  assert.match(violations, /default-src/);
  assert.match(violations, /remote HTTPS/);
});

test("unapproved Tauri capability and plugin are rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/capabilities/main.json",
    '{"permissions":["core:default","shell:default"]}\n',
  );
  write(
    root,
    "apps/desktop/package.json",
    '{"dependencies":{"@tauri-apps/plugin-shell":"2.0.0"}}\n',
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /plugin-shell/);
  assert.match(violations, /shell:default/);
});

test("Rust debug placeholders are rejected outside cfg(test)", (t) => {
  const root = fixture(t);
  write(
    root,
    "crates/vault-core/src/lib.rs",
    "pub fn unsafe_placeholder() { todo!(); }\n#[cfg(test)]\nmod tests { fn okay() { dbg!(1); } }\n",
  );
  const violations = runChecks(root);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /:1:/);
});
