import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runChecks } from "../check_ios_foundation.mjs";

const apple = "apps/desktop/src-tauri/gen/apple";
const projectPath = `${apple}/NianPass.xcodeproj/project.pbxproj`;
const hostPath = `${apple}/NianPass/Host.swift`;
const credentialPath = `${apple}/AutoFill/CredentialProviderViewController.swift`;
const bridgePath = `${apple}/AutoFill/RustCredentialBridge.swift`;
const keychainPath = `${apple}/NianPass/KeychainPolicy.swift`;

function write(root, name, content) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function replace(root, name, original, replacement) {
  const path = join(root, name);
  const source = readFileSync(path, "utf8");
  assert.ok(
    source.includes(original),
    `fixture ${name} must contain ${original}`,
  );
  writeFileSync(path, source.replace(original, replacement));
}

function entitlements() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>com.apple.developer.authentication-services.autofill-credential-provider</key><true/>
<key>com.apple.security.application-groups</key><array><string>group.example.nianpass</string></array>
<key>keychain-access-groups</key><array><string>$(AppIdentifierPrefix)example.shared</string></array>
</dict></plist>
`;
}

function fixture(t, { includeSwift = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-ios-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(
    root,
    projectPath,
    `IPHONEOS_DEPLOYMENT_TARGET = 14.0;
productType = "com.apple.product-type.app-extension";
path = AutoFill.appex;
name = "Embed App Extensions";
dstSubfolderSpec = 13;
Host.swift in Sources
CredentialProviderViewController.swift in Sources
RustCredentialBridge.swift in Sources
`,
  );
  write(root, `${apple}/NianPass/NianPass.entitlements`, entitlements());
  write(root, `${apple}/AutoFill/AutoFill.entitlements`, entitlements());
  write(
    root,
    `${apple}/AutoFill/Info.plist`,
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>NSExtension</key><dict>
<key>NSExtensionPointIdentifier</key>
<string>com.apple.authentication-services-credential-provider-ui</string>
<key>NSExtensionAttributes</key><dict>
<key>ASCredentialProviderExtensionCapabilities</key><dict>
<key>ProvidesPasswords</key><true/>
</dict></dict></dict>
</dict></plist>
`,
  );

  if (!includeSwift) return root;
  write(
    root,
    hostPath,
    `import AuthenticationServices
import UIKit

final class HostDocumentAdapter {
    let mirrorName = "AutoFill/vault.kdbx"

    func selectAndCoordinate() {
        _ = UIDocumentPickerViewController(forOpeningContentTypes: [])
        let url = URL(fileURLWithPath: "/synthetic")
        guard url.startAccessingSecurityScopedResource() else { return }
        defer { url.stopAccessingSecurityScopedResource() }
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: nil) { _ in }
        _ = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.example.nianpass")
        _ = FileProtectionType.complete
        _ = ASCredentialIdentityStore.shared
        _ = ASPasswordCredentialIdentity.self
    }
}
`,
  );
  write(
    root,
    credentialPath,
    `import AuthenticationServices

final class CredentialProviderViewController: ASCredentialProviderViewController {
    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {}

    override func prepareInterfaceToProvideCredential(for credentialIdentity: ASPasswordCredentialIdentity) {
        _ = ASPasswordCredential(user: "synthetic", password: "synthetic")
    }
}
`,
  );
  write(
    root,
    bridgePath,
    `func exerciseReviewedRustFfi(handle: UInt64) {
    _ = np_ios_open_vault(nil, 0, nil, 0, nil, 0, 0, nil)
    _ = np_ios_copy_candidates_json(handle, nil, 0, nil)
    _ = np_ios_copy_identities_json(handle, nil, 0, nil)
    _ = np_ios_copy_credential(handle, nil, 0, nil, 0, nil)
    np_ios_free_buffer(nil, 0, 0)
    np_ios_free_secret_result(nil)
    _ = np_ios_close_vault(handle)
}
`,
  );
  write(
    root,
    keychainPath,
    `let sharedKeychainQuery: [String: Any] = [
    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    kSecAttrSynchronizable as String: false,
]
`,
  );
  return root;
}

test("missing official Apple project fails closed", (t) => {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-ios-missing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.match(
    runChecks(root).join("\n"),
    /official Tauri Apple project is missing/u,
  );
});

test("realistic password-only Credential Provider source fixture passes", (t) => {
  assert.deepEqual(runChecks(fixture(t)), []);
});

test("behavioral markers only in project.pbxproj cannot fake Swift", (t) => {
  const root = fixture(t, { includeSwift: false });
  write(
    root,
    projectPath,
    `${readFileSync(join(root, projectPath), "utf8")}
ASCredentialProviderViewController UIDocumentPickerViewController NSFileCoordinator
startAccessingSecurityScopedResource stopAccessingSecurityScopedResource
provideCredentialWithoutUserInteraction userInteractionRequired prepareCredentialList
prepareInterfaceToProvideCredential ASPasswordCredential cancelRequest
np_ios_open_vault() np_ios_copy_candidates_json() np_ios_copy_identities_json()
np_ios_copy_credential() np_ios_free_buffer() np_ios_free_secret_result() np_ios_close_vault()
`,
  );
  assert.match(
    runChecks(root).join("\n"),
    /Swift Credential Provider implementation missing/u,
  );
});

test("missing Swift Credential Provider subclass fails", (t) => {
  const root = fixture(t);
  replace(
    root,
    credentialPath,
    "ASCredentialProviderViewController",
    "NSObject",
  );
  assert.match(
    runChecks(root).join("\n"),
    /Swift Credential Provider implementation missing/u,
  );
});

for (const symbol of [
  "np_ios_open_vault",
  "np_ios_copy_candidates_json",
  "np_ios_copy_identities_json",
  "np_ios_copy_credential",
  "np_ios_close_vault",
]) {
  test(`missing ${symbol} call fails`, (t) => {
    const root = fixture(t);
    replace(root, bridgePath, symbol, `missing_${symbol}`);
    assert.match(
      runChecks(root).join("\n"),
      new RegExp(`must use ${symbol}`, "u"),
    );
  });
}

for (const symbol of ["np_ios_free_buffer", "np_ios_free_secret_result"]) {
  test(`missing ownership call ${symbol} fails`, (t) => {
    const root = fixture(t);
    replace(root, bridgePath, symbol, `missing_${symbol}`);
    assert.match(
      runChecks(root).join("\n"),
      new RegExp(`must use ${symbol}`, "u"),
    );
  });
}

for (const comment of [
  "// np_ios_copy_credential(handle, nil, 0, nil, 0, nil)",
  "/* np_ios_copy_credential(handle, nil, 0, nil, 0, nil) */",
]) {
  test(`comment-only final credential call fails: ${comment.slice(0, 2)}`, (t) => {
    const root = fixture(t);
    replace(
      root,
      bridgePath,
      "_ = np_ios_copy_credential(handle, nil, 0, nil, 0, nil)",
      comment,
    );
    assert.match(
      runChecks(root).join("\n"),
      /must use np_ios_copy_credential/u,
    );
  });
}

test("string-only final credential marker fails", (t) => {
  const root = fixture(t);
  replace(
    root,
    bridgePath,
    "_ = np_ios_copy_credential(handle, nil, 0, nil, 0, nil)",
    'let marker = "np_ios_copy_credential("',
  );
  assert.match(runChecks(root).join("\n"), /must use np_ios_copy_credential/u);
});

test("duplicate Swift KDBX backend fails", (t) => {
  const root = fixture(t);
  write(
    root,
    `${apple}/AutoFill/KdbxParser.swift`,
    "final class KdbxParser { let key: DatabaseKey? = nil; func deriveWithArgon2() {} }\n",
  );
  assert.match(
    runChecks(root).join("\n"),
    /must not implement a duplicate KDBX backend/u,
  );
});

test("passkey capability fails", (t) => {
  const root = fixture(t);
  replace(
    root,
    `${apple}/AutoFill/Info.plist`,
    "<key>ProvidesPasswords</key><true/>",
    "<key>ProvidesPasswords</key><true/><key>ProvidesPasskeys</key><true/>",
  );
  assert.match(
    runChecks(root).join("\n"),
    /must not contain ProvidesPasskeys/u,
  );
});

test("one-time-code capability fails", (t) => {
  const root = fixture(t);
  replace(
    root,
    `${apple}/AutoFill/Info.plist`,
    "<key>ProvidesPasswords</key><true/>",
    "<key>ProvidesPasswords</key><true/><key>ProvidesOneTimeCodes</key><true/>",
  );
  assert.match(
    runChecks(root).join("\n"),
    /must not contain ProvidesOneTimeCodes/u,
  );
});

test("WebView usage fails", (t) => {
  const root = fixture(t);
  write(
    root,
    `${apple}/AutoFill/WebView.swift`,
    "let forbiddenWebView = WKWebView()\n",
  );
  assert.match(runChecks(root).join("\n"), /must not contain WKWebView/u);
});

test("plaintext identity index fails", (t) => {
  const root = fixture(t);
  write(
    root,
    `${apple}/AutoFill/Index.swift`,
    'let forbiddenIndex = "identities.json"\n',
  );
  assert.match(
    runChecks(root).join("\n"),
    /must not contain identities\.json/u,
  );
});

test("kSecAttrSynchronizable=true fails", (t) => {
  const root = fixture(t);
  replace(
    root,
    keychainPath,
    "kSecAttrSynchronizable as String: false",
    "kSecAttrSynchronizable as String: true",
  );
  assert.match(
    runChecks(root).join("\n"),
    /must reject kSecAttrSynchronizable=true/u,
  );
});

test("kCFBooleanFalse synchronizable policy passes", (t) => {
  const root = fixture(t);
  replace(
    root,
    keychainPath,
    "kSecAttrSynchronizable as String: false",
    "kSecAttrSynchronizable as String: kCFBooleanFalse",
  );
  assert.deepEqual(runChecks(root), []);
});

test("host document APIs only in project.pbxproj fail", (t) => {
  const root = fixture(t);
  write(root, hostPath, readFileSync(join(root, keychainPath), "utf8"));
  write(
    root,
    projectPath,
    `${readFileSync(join(root, projectPath), "utf8")}
UIDocumentPickerViewController startAccessingSecurityScopedResource
stopAccessingSecurityScopedResource NSFileCoordinator
`,
  );
  assert.match(
    runChecks(root).join("\n"),
    /production Swift source is missing UIDocumentPickerViewController/u,
  );
});
