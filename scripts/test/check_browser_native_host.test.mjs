import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runNativeHostChecks } from "../check_browser_native_host.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

test("current native host satisfies authority and framing ratchets", () => {
  assert.deepEqual(runNativeHostChecks(repositoryRoot), []);
});

test("ratchet rejects vault authority and stdout diagnostics", (t) => {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-native-host-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(repositoryRoot, "apps"), join(root, "apps"), { recursive: true });
  cpSync(join(repositoryRoot, "crates"), join(root, "crates"), {
    recursive: true,
  });
  cpSync(join(repositoryRoot, "browser"), join(root, "browser"), {
    recursive: true,
  });
  const manifest = join(root, "apps/browser-native-host/Cargo.toml");
  writeFileSync(manifest, `${readFileSync(manifest)}\nkdbx = "=1.0.0"\n`);
  const main = join(root, "apps/browser-native-host/src/main.rs");
  writeFileSync(main, `${readFileSync(main)}\nprintln!("bad");\n`);
  const violations = runNativeHostChecks(root).join("\n");
  assert.match(violations, /KDBX and vault-session dependencies are forbidden/);
  assert.match(violations, /stdout diagnostics/);
});

test("ratchet rejects bypassing the Windows cross-resource transaction", (t) => {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-native-host-transaction-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(repositoryRoot, "apps"), join(root, "apps"), { recursive: true });
  cpSync(join(repositoryRoot, "crates"), join(root, "crates"), {
    recursive: true,
  });
  cpSync(join(repositoryRoot, "browser"), join(root, "browser"), {
    recursive: true,
  });
  const installer = join(root, "apps/browser-native-host/src/installer.rs");
  writeFileSync(
    installer,
    readFileSync(installer, "utf8").replace(
      "crate::installer_transaction::install(",
      "legacy_install(",
    ),
  );
  assert.match(
    runNativeHostChecks(root).join("\n"),
    /install must use the manifest and HKCU transaction policy/,
  );
});
