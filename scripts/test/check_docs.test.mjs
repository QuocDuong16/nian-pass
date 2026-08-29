import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runChecks } from "../check_docs.mjs";

function write(root, name, content) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-docs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(
    root,
    "README.md",
    "M5.4 — iOS Password AutoFill + Keychain — BLOCKED\nRead-only providers have editing and Save disabled. " +
      "AtomicFile recovery journal leads to save_uncertain or recovery_required.\nM4.5 — Desktop Security UX\nExplicit Save. " +
      "External divergence is not automatically merged. No Save As, force overwrite, or autosave.\n" +
      "make quality-check\nHeadless Linux\nWindows persistence remains deferred. " +
      "The active clipboard clears only if it still contains the value written by Nian Pass. " +
      "The timeout is application-memory only. The privacy shield is not universal screenshot prevention. " +
      "Android 8.0 / API 26. make mobile-android-check. " +
      "CredentialProviderService on API 34 then AutofillService on API 26. " +
      "Source remembering is explicit opt-in using AES-256-GCM and still requires the master password again. " +
      "The exact package and SHA-256 signing-certificate pin require explicit confirmation when untrusted.\n",
  );
  write(
    root,
    "docs/architecture.md",
    "M4.Q quality architecture. Clipboard salt then SHA-256 fingerprint then generation. " +
      "apps/desktop remains the historical shared host. content:// maps to an opaque source token and encrypted generation baseline. " +
      "VaultSession is NOT used; MobileVaultSession never owns a URI or fake canonical provider path. " +
      "A residual cooperative writer race remains and read-back cannot prove every interleaving. " +
      "Android OS request uses an opaque request token and reaches a backend-only native final result. " +
      "Android Keystore encrypts the source bookmark with no master password and no derived key. " +
      "A populated origin failure is unavailable; isOriginPopulated() then getOrigin(privilegedAllowlist). " +
      "retrieveBeginGetCredentialRequest() and retrieveProviderGetCredentialRequest() rebuild authority after process restart. " +
      "The bookmark has a READ-only SAF flag; Lock verifies READ=yes and WRITE=no.\n" +
      "UIDocumentPickerViewController uses NSFileCoordinator before an encrypted App Group mirror. " +
      "Host-only access group stores the bookmark; Keychain NEVER stores a master password. " +
      "np_ios_open_vault uses explicit FFI ownership and panic containment.\n",
  );
  write(
    root,
    "docs/threat-model.md",
    "Compromised supply-chain dependencies. OS clipboard history may retain data. " +
      "A dirty timeout never performs discard without explicit user intent. " +
      "iOS is not initialized or built on Linux; validation requires macOS with Xcode. " +
      "A fake Android application, changed signing key, unverified web target, and replayed request token fail closed. " +
      "A browser confused deputy, process death, stale PendingIntent, and singleTop stale intent fail closed. " +
      "setUserAuthenticationRequired(false) protects metadata with no master password.\n" +
      "The extension is a separate short-lived process. Mirror size and SHA-256 reject tampering before identity release.\n",
  );
  write(
    root,
    "docs/write-safety.md",
    "Windows persistence is unsupported and fails closed.\n",
  );
  write(
    root,
    "docs/quality.md",
    "Coverage ratchet. Lowering requires architecture or security review. eslint-disable is forbidden. " +
      "unsafe_code = forbid. Exceptions require an exact path. cargo-deny. pnpm audit --prod. " +
      "navigator.clipboard is forbidden. clipboard-manager only in apps/desktop/src-tauri. " +
      "Rust 1.98.0. Corepack 0.35.0. OpenWiki is not the source of truth. " +
      "mobile-tools-check then mobile-android-check. credentials:1.6.0 and a single-use opaque token.\n" +
      "mobile-ios-tools-check requires macOS; mobile-ios-check verifies an embedded .appex extension.\n",
  );
  write(root, "AGENTS.md", "Do not hand-edit generated OpenWiki pages.\n");
  write(root, ".node-version", "26.7.0\n");
  write(
    root,
    "package.json",
    '{"engines":{"node":"26.7.0"},"packageManager":"pnpm@11.22.0"}\n',
  );
  write(
    root,
    ".forgejo/workflows/quality.yml",
    "node:26.7.0\nrust:1.98.0-bookworm\nnpm install --global corepack@0.35.0\npnpm@11.22.0\n",
  );
  write(root, ".mise.toml", '[tools]\nrust = "1.98.0"\n');
  write(root, "rust-toolchain.toml", '[toolchain]\nchannel = "1.98.0"\n');
  write(root, "Makefile", "RUST_VERSION := $(shell awk -F'\\\"' '/^rust = / { print $$2 }' .mise.toml)\n");
  return root;
}

test("complete policy documentation passes", (t) => {
  assert.deepEqual(runChecks(fixture(t)), []);
});

test("runtime version drift is rejected", (t) => {
  const root = fixture(t);
  write(root, ".node-version", "26.7.1\n");
  assert.match(runChecks(root).join("\n"), /same exact version/);
});

test("Rust toolchain drift from mise is rejected", (t) => {
  const root = fixture(t);
  write(root, "rust-toolchain.toml", '[toolchain]\nchannel = "1.97.1"\n');
  assert.match(runChecks(root).join("\n"), /must mirror mise Rust 1\.98\.0/);
});

test("missing explicit Corepack bootstrap is rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    ".forgejo/workflows/quality.yml",
    "node:26.7.0\nrust:1.98.0-bookworm\npnpm@11.22.0\n",
  );
  assert.match(
    runChecks(root).join("\n"),
    /Corepack 0\.35\.0 must be installed explicitly/,
  );
});

test("missing quality policy is reported", (t) => {
  const root = fixture(t);
  write(root, "docs/quality.md", "OpenWiki\n");
  const violations = runChecks(root).join("\n");
  assert.match(violations, /coverage ratchet/);
  assert.match(violations, /unsafe Rust/);
});
