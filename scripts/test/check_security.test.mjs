import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runChecks } from "../check_security.mjs";

const approvedCsp =
  "default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' asset: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
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

function packageManifest(name, dependencies = "") {
  return `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\npublish = false\n\n${dependencies}`;
}

function writeCsp(root, csp) {
  write(
    root,
    "apps/desktop/src-tauri/tauri.conf.json",
    JSON.stringify({ app: { security: { csp } } }),
  );
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-security-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "apps/desktop/src/App.tsx", "export const App = () => null;\n");
  write(
    root,
    "Cargo.toml",
    `[workspace]\nmembers = ${JSON.stringify(workspaceMembers)}\nexclude = ["support/tauri-plugin-shell", "support/tauri-plugin-clipboard-manager"]\nresolver = "3"\n`,
  );
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
  write(
    root,
    "apps/desktop/package.json",
    '{"dependencies":{"@tauri-apps/api":"2.11.1"}}\n',
  );
  const manifests = {
    "apps/desktop/src-tauri/Cargo.toml": "nian-pass-desktop",
    "apps/cli/Cargo.toml": "nian-pass-cli",
    "crates/kdbx/Cargo.toml": "kdbx",
    "crates/vault-core/Cargo.toml": "vault-core",
    "crates/vault-session/Cargo.toml": "vault-session",
    "crates/vault-sync/Cargo.toml": "vault-sync",
  };
  for (const [path, packageName] of Object.entries(manifests)) {
    write(root, path, packageManifest(packageName));
  }
  write(
    root,
    "apps/desktop/src-tauri/capabilities/main.json",
    '{"identifier":"main-window","windows":["main"],"permissions":["core:default","core:window:allow-destroy"]}\n',
  );
  writeCsp(root, approvedCsp);
  return root;
}

test("approved capability, CSP, dependencies, and source pass", (t) => {
  assert.deepEqual(runChecks(fixture(t)), []);
});

test("browser storage and console output are rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src/App.tsx",
    'console.error(localStorage.getItem("vault"));\n',
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /console logging/);
  assert.match(violations, /browser persistence/);
});

test("browser clipboard access spellings are rejected", (t) => {
  for (const source of [
    "navigator.clipboard.writeText('x');\n",
    "window.navigator.clipboard.readText();\n",
    "globalThis.navigator?.clipboard.clear();\n",
    "navigator['clipboard'].writeText('x');\n",
  ]) {
    const root = fixture(t);
    write(root, "apps/desktop/src/App.tsx", source);
    assert.match(
      runChecks(root).join("\n"),
      /browser clipboard access is forbidden/,
    );
  }
});

test("remote script origin is rejected", (t) => {
  const root = fixture(t);
  writeCsp(
    root,
    approvedCsp.replace(
      "script-src 'self'",
      "script-src 'self' https://evil.example",
    ),
  );
  assert.match(
    runChecks(root).join("\n"),
    /script-src token https:\/\/evil\.example is not approved/,
  );
});

test("unsafe-inline script behavior is rejected", (t) => {
  const root = fixture(t);
  writeCsp(
    root,
    approvedCsp.replace(
      "script-src 'self'",
      "script-src 'self' 'unsafe-inline'",
    ),
  );
  assert.match(
    runChecks(root).join("\n"),
    /script-src token 'unsafe-inline' is not approved/,
  );
});

test("unsafe-eval, wildcard script, and wildcard default sources are rejected", (t) => {
  const root = fixture(t);
  writeCsp(
    root,
    approvedCsp
      .replace("default-src 'self'", "default-src *")
      .replace("script-src 'self'", "script-src 'unsafe-eval' *"),
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /default-src token \* is not approved/);
  assert.match(violations, /script-src token 'unsafe-eval' is not approved/);
  assert.match(violations, /script-src token \* is not approved/);
});

test("specific remote connect origin is rejected", (t) => {
  const root = fixture(t);
  writeCsp(
    root,
    approvedCsp.replace(
      "connect-src ipc: http://ipc.localhost",
      "connect-src ipc: http://ipc.localhost https://evil.example",
    ),
  );
  assert.match(
    runChecks(root).join("\n"),
    /connect-src token https:\/\/evil\.example is not approved/,
  );
});

test("scheme-wide HTTP connect source is rejected", (t) => {
  const root = fixture(t);
  writeCsp(root, approvedCsp.replace("http://ipc.localhost", "http:"));
  assert.match(
    runChecks(root).join("\n"),
    /connect-src token http: is not approved/,
  );
});

test("other remote connect schemes and wildcards are rejected", (t) => {
  for (const token of ["https:", "ws:", "wss:", "*"]) {
    const root = fixture(t);
    writeCsp(root, approvedCsp.replace("http://ipc.localhost", token));
    assert.ok(
      runChecks(root).some((violation) =>
        violation.includes(`connect-src token ${token} is not approved`),
      ),
    );
  }
});

test("duplicate script-src directive is rejected", (t) => {
  const root = fixture(t);
  writeCsp(root, `${approvedCsp}; script-src https://evil.example`);
  assert.match(
    runChecks(root).join("\n"),
    /duplicate script-src directive is forbidden/,
  );
});

test("object-src must use its approved none source", (t) => {
  const root = fixture(t);
  writeCsp(root, approvedCsp.replace("object-src 'none'", "object-src 'self'"));
  assert.match(
    runChecks(root).join("\n"),
    /object-src token 'self' is not approved/,
  );
});

test("required CSP directives may not be omitted", (t) => {
  const root = fixture(t);
  writeCsp(root, approvedCsp.replace("; object-src 'none'", ""));
  assert.match(
    runChecks(root).join("\n"),
    /required directive object-src is missing/,
  );
});

test("unknown CSP directives require policy review", (t) => {
  const root = fixture(t);
  writeCsp(root, `${approvedCsp}; worker-src 'self'`);
  assert.match(
    runChecks(root).join("\n"),
    /directive worker-src is not approved/,
  );
});

test("unapproved Tauri capability and plugin are rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/capabilities/main.json",
    '{"identifier":"main-window","windows":["main"],"permissions":["core:default","core:window:allow-destroy","shell:default"]}\n',
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

test("main window capability remains narrowly scoped to approved destroy", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/capabilities/main.json",
    '{"identifier":"main-window","windows":["main","other"],"permissions":["core:default","core:window:allow-destroy","core:window:allow-close"]}\n',
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /scoped to only the main window/);
  assert.match(
    violations,
    /requires exactly core:default and core:window:allow-destroy/,
  );
  assert.match(violations, /allow-close/);
});

test("renamed forbidden Rust Tauri plugin is rejected by actual package name", (t) => {
  const root = fixture(t);
  write(
    root,
    "support/tauri-plugin-shell/Cargo.toml",
    packageManifest("tauri-plugin-shell"),
  );
  write(root, "support/tauri-plugin-shell/src/lib.rs", "pub fn support() {}\n");
  write(
    root,
    "apps/desktop/src-tauri/Cargo.toml",
    packageManifest(
      "nian-pass-desktop",
      '[dependencies]\nshell-runtime = { package = "tauri-plugin-shell", path = "../../../support/tauri-plugin-shell" }\n',
    ),
  );
  assert.match(
    runChecks(root).join("\n"),
    /shell-runtime \(package tauri-plugin-shell\)/,
  );
});

test("npm alias of a forbidden Tauri plugin is rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/package.json",
    '{"dependencies":{"shell-runtime":"npm:@tauri-apps/plugin-shell@2.0.0"}}\n',
  );
  assert.match(
    runChecks(root).join("\n"),
    /shell-runtime \(package @tauri-apps\/plugin-shell\)/,
  );
});

test("official Rust clipboard plugin is allowed only in desktop", (t) => {
  const root = fixture(t);
  write(
    root,
    "support/tauri-plugin-clipboard-manager/Cargo.toml",
    packageManifest("tauri-plugin-clipboard-manager"),
  );
  write(
    root,
    "support/tauri-plugin-clipboard-manager/src/lib.rs",
    "pub fn support() {}\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/Cargo.toml",
    packageManifest(
      "nian-pass-desktop",
      '[dependencies]\nclipboard = { package = "tauri-plugin-clipboard-manager", path = "../../../support/tauri-plugin-clipboard-manager" }\n',
    ),
  );
  assert.deepEqual(runChecks(root), []);

  write(
    root,
    "crates/vault-core/Cargo.toml",
    packageManifest(
      "vault-core",
      '[dependencies]\ncb = { package = "tauri-plugin-clipboard-manager", path = "../../support/tauri-plugin-clipboard-manager" }\n',
    ),
  );
  assert.match(
    runChecks(root).join("\n"),
    /cb \(package tauri-plugin-clipboard-manager\)/,
  );
});

test("npm alias of clipboard manager remains forbidden", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/package.json",
    '{"dependencies":{"clipboard":"npm:@tauri-apps/plugin-clipboard-manager@2.3.2"}}\n',
  );
  assert.match(
    runChecks(root).join("\n"),
    /clipboard \(package @tauri-apps\/plugin-clipboard-manager\)/,
  );
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
