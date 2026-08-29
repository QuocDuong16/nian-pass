import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runChecks } from "../check_ios_foundation.mjs";

function write(root, name, content) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-ios-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(
    root,
    "apps/desktop/src-tauri/gen/apple/NianPass.xcodeproj/project.pbxproj",
    `IPHONEOS_DEPLOYMENT_TARGET = 14.0
ASCredentialProviderViewController
UIDocumentPickerViewController
startAccessingSecurityScopedResource
stopAccessingSecurityScopedResource
NSFileCoordinator
containerURL(forSecurityApplicationGroupIdentifier:
FileProtectionType.complete
AutoFill/vault.kdbx
kSecAttrAccessibleWhenUnlockedThisDeviceOnly
kSecAttrSynchronizable
ASCredentialIdentityStore
ASPasswordCredentialIdentity
provideCredentialWithoutUserInteraction
userInteractionRequired
prepareCredentialList
prepareInterfaceToProvideCredential
ASPasswordCredential
cancelRequest
`,
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/apple/NianPass/NianPass.entitlements",
    `com.apple.developer.authentication-services.autofill-credential-provider
com.apple.security.application-groups
keychain-access-groups
`,
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/apple/AutoFill/Info.plist",
    "ProvidesPasswords\n",
  );
  return root;
}

test("missing official Apple project fails closed", (t) => {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-ios-missing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.match(runChecks(root).join("\n"), /official Tauri Apple project is missing/);
});

test("password-only Credential Provider build graph passes", (t) => {
  assert.deepEqual(runChecks(fixture(t)), []);
});

test("passkey, OTP, WebView, and plaintext index claims are rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/gen/apple/AutoFill/Forbidden.swift",
    "ProvidesPasskeys ProvidesOneTimeCodes WKWebView UserDefaults identities.json entries.json autofill-index.json",
  );
  const violations = runChecks(root).join("\n");
  for (const forbidden of [
    "ProvidesPasskeys",
    "ProvidesOneTimeCodes",
    "WKWebView",
    "UserDefaults",
    "identities.json",
    "entries.json",
    "autofill-index.json",
  ]) {
    assert.match(violations, new RegExp(forbidden.replace(".", "\\."), "u"));
  }
});
