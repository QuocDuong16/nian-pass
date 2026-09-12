import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    "## Current milestone\nM8 — Security Hardening / Release Engineering — IN PROGRESS\nM5.4 — iOS Password AutoFill + Keychain — DEFERRED\nM5.5 Android Mobile Security / Lifecycle DONE\nM6 Browser Extension Foundation DONE\nM6.5 Browser Native Messaging / Desktop Integration DONE\nM7 BYO-cloud Sync Providers DONE\nM7.5 Self-hosted Sync Gateway NEXT\nDesktop explicit sync supports WebDAV and AWS S3. Sync is manual only and provider credentials are not persisted.\nBrowser integration uses Chromium/Firefox MV3 with explicit per-site access, Nian Pass Native Messaging host, exact-document fill, and never automatically submit. Read-only providers have editing and Save disabled. " +
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
      "M6.5 browser and desktop credential boundary: background extension authority then Native Messaging stdio, user-local Unix socket or Windows named pipe, DesktopVaultService, and credential-provider-core. Browser host permission is not credential identity. " +
      "BrowserBridgeState is always Available or Unavailable; secure bind failure does not abort desktop setup and recovery uses a desktop restart. Windows manifest and HKCU registration restore both states on rollback. " +
      "M5.5 uses FLAG_SECURE and setRecentsScreenshotEnabled(false) before the privacy curtain. " +
      "SystemClock.elapsedRealtime() feeds a monotonic generation and exact safe-UI acknowledgement. " +
      "Global processForeground and screen state are separate from per-Activity activityResumed and windowFocused. ProcessLifecycleOwner is not the immediate confidentiality boundary. MainActivity and CredentialActivity cannot authorize one another. " +
      "PowerManager.isInteractive precedes KeyguardManager.isDeviceLocked. " +
      "Security attention suppresses Save and reload dialogs; in-flight work continues and is reconciled rather than cancelled. " +
      "A dirty draft remains shielded and lifecycle never autosaves or discards it.\n" +
      "M7 BYO-cloud sync boundary receives encrypted remote KDBX bytes + opaque RemoteRevision through sync-provider-core, then sync-engine calls vault-sync::merge. A private journal precedes conditional remote CAS and persists BASE last. " +
      "Each profile_id identifies one immutable local-source + remote-target relationship. A malicious or broken server can ignore conditional headers after a successful overwrite, and the client cannot always detect that violation. " +
      "UIDocumentPickerViewController uses NSFileCoordinator before an encrypted App Group mirror. " +
      "Host-only access group stores the bookmark; Keychain NEVER stores a master password. " +
      "np_ios_open_vault uses explicit FFI ownership and panic containment.\n",
  );
  write(
    root,
    "docs/threat-model.md",
    "Compromised supply-chain dependencies. OS clipboard history may retain data. Web page / DOM is untrusted; content script is a low-trust adapter; background extension context is privileged; native host is transport-only. A same-user local IPC attacker requires desktop approval; residual threats include a fully compromised OS and root/Administrator. " +
      "Browser bridge startup denial of service and live endpoint conflict leave the desktop vault remains usable. " +
      "A dirty timeout never performs discard without explicit user intent. " +
      "iOS is not initialized or built on Linux; validation requires macOS with Xcode. " +
      "A fake Android application, changed signing key, unverified web target, and replayed request token fail closed. " +
      "A browser confused deputy, process death, stale PendingIntent, and singleTop stale intent fail closed. " +
      "setUserAuthenticationRequired(false) protects metadata with no master password.\n" +
      "FLAG_SECURE cannot defeat root or a compromised OS; monotonic policy rejects wall-clock rollback. " +
      "Android process death can lose unsaved edits, but plaintext recovery persistence is forbidden.\n" +
      "The extension is a separate short-lived process. Mirror size and SHA-256 reject tampering before identity release.\n" +
      "M7 models a malicious or broken provider, stale revisions, and servers ignoring conditional headers. It rejects TLS downgrade, redirect credential leaks, AWS credential-chain surprise, and oversized objects. M7 makes no cryptographic remote rollback or conditional-enforcement claim. A successful protocol violation cannot always be detected by read-back; CAS protects concurrency only when the provider cooperates.\n",
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
      "M5.5 requires PowerManager.isInteractive and SystemClock.elapsedRealtime lifecycle source ratchets; same-process Lock/unlock timeout retention and new-root reset are tested; Android instrumentation only compiles headlessly.\n" +
      "mobile-ios-tools-check requires macOS; mobile-ios-check verifies an embedded .appex extension. browser-source-check then browser-extension-check then browser-native-protocol-check then browser-native-host-check then browser-integration-check do not require Chrome Chromium or Firefox GUI browsers.\n" +
      "Bridge startup failure leaves the vault usable; Windows installer rollback is tested with failure injection.\n" +
      "sync-source-check then sync-core-check then sync-provider-check then sync-integration-check cover M7.\n",
  );
  write(
    root,
    "SECURITY.md",
    "Supported versions use the latest release. Reporting a vulnerability uses a private report. The project does not promise a response SLA.\n",
  );
  write(
    root,
    "docs/security-audit-m8.md",
    "BLOCKER release issue fixed. HIGH filesystem issue fixed. ACCEPTED RISK remains documented. Secret inventory records lifetimes.\n",
  );
  write(
    root,
    "docs/release.md",
    "Use a clean checkout then make release-source-check. Generate SHA-256 and report runtime evidence as NOT RUN when unavailable.\n",
  );
  write(
    root,
    "docs/reproducible-builds.md",
    "VERSION is authoritative. Rust 1.98.0 is pinned. Generate a CycloneDX inventory.\n",
  );
  write(
    root,
    "docs/release-checklist.md",
    "No committed secrets. Verify CSP. Record runtime checks as PASS or NOT RUN.\n",
  );
  write(
    root,
    "docs/release-status-template.md",
    "Forgejo canonical CI. Windows full GUI runtime. Android runtime. Artifact secret scan. GitHub Release publication.\n",
  );
  write(
    root,
    "docs/ipc-surface.md",
    "Session control owns Lock. Vault mutation is Rust-owned. Browser approval is opaque. Android remains native.\n",
  );
  write(root, "AGENTS.md", "Do not hand-edit generated OpenWiki pages.\n");
  write(root, ".node-version", "26.8.1\n");
  write(
    root,
    "package.json",
    '{"engines":{"node":"26.8.1"},"packageManager":"pnpm@11.22.0"}\n',
  );
  write(
    root,
    ".forgejo/workflows/quality.yml",
    "jobs:\n" +
      "  desktop-frontend:\n" +
      "    container:\n" +
      "      image: node:26.8.1-bookworm\n" +
      "    steps:\n" +
      "      - run: make browser-source-check browser-extension-check\n" +
      "  desktop-native-check:\n" +
      "    container:\n" +
      "      image: rust:1.98.0-bookworm\n" +
      "    steps:\n" +
      "      - run: npm install --global corepack@0.35.0\n" +
      "      - run: corepack install --global pnpm@11.22.0\n" +
      "      - run: make browser-integration-check\n",
  );
  write(root, ".mise.toml", '[tools]\nrust = "1.98.0"\n');
  write(root, "rust-toolchain.toml", '[toolchain]\nchannel = "1.98.0"\n');
  write(
    root,
    "Makefile",
    "RUST_VERSION := $(shell awk -F'\\\"' '/^rust = / { print $$2 }' .mise.toml)\n",
  );
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
    "jobs:\n" +
      "  desktop-frontend:\n" +
      "    container:\n" +
      "      image: node:26.8.1-bookworm\n" +
      "  desktop-native-check:\n" +
      "    container:\n" +
      "      image: rust:1.98.0-bookworm\n" +
      "    steps:\n" +
      "      - run: corepack install --global pnpm@11.22.0\n" +
      "      - run: make browser-integration-check\n",
  );
  assert.match(
    runChecks(root).join("\n"),
    /Corepack 0\.35\.0 must be installed explicitly/,
  );
});

test("browser integration cannot run in the Node-only frontend job", (t) => {
  const root = fixture(t);
  const workflow = readFileSync(
    join(root, ".forgejo/workflows/quality.yml"),
    "utf8",
  ).replace(
    "make browser-source-check browser-extension-check",
    "make browser-source-check browser-extension-check browser-integration-check",
  );
  write(root, ".forgejo/workflows/quality.yml", workflow);
  assert.match(runChecks(root).join("\n"), /must not run in the Node-only/);
});

test("browser integration requires the native Rust job and pinned pnpm", (t) => {
  const root = fixture(t);
  const workflow = readFileSync(
    join(root, ".forgejo/workflows/quality.yml"),
    "utf8",
  )
    .replace("      - run: npm install --global corepack@0.35.0\n", "")
    .replace("      - run: corepack install --global pnpm@11.22.0\n", "")
    .replace("      - run: make browser-integration-check\n", "");
  write(root, ".forgejo/workflows/quality.yml", workflow);
  const violations = runChecks(root).join("\n");
  assert.match(violations, /must own browser-integration-check/);
  assert.match(violations, /must install pinned Corepack 0\.35\.0/);
  assert.match(violations, /must activate pinned pnpm 11\.22\.0/);
});

test("missing quality policy is reported", (t) => {
  const root = fixture(t);
  write(root, "docs/quality.md", "OpenWiki\n");
  const violations = runChecks(root).join("\n");
  assert.match(violations, /coverage ratchet/);
  assert.match(violations, /unsafe Rust/);
});
