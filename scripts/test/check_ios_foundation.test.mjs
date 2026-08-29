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
const hostBridgePath = `${apple}/NianPass/RustCredentialBridge.swift`;
const hostSubclassPath = `${apple}/NianPass/HostCredentialProvider.swift`;
const credentialPath = `${apple}/AutoFill/CredentialProviderViewController.swift`;
const bridgePath = `${apple}/AutoFill/RustCredentialBridge.swift`;
const keychainPath = `${apple}/NianPass/KeychainPolicy.swift`;

const pbx = {
  project: "A00000000000000000000001",
  mainGroup: "A00000000000000000000002",
  hostGroup: "A00000000000000000000003",
  extensionGroup: "A00000000000000000000004",
  productsGroup: "A00000000000000000000005",
  hostRef: "B00000000000000000000001",
  hostBridgeRef: "B00000000000000000000002",
  hostSubclassRef: "B00000000000000000000003",
  credentialRef: "B00000000000000000000004",
  extensionBridgeRef: "B00000000000000000000005",
  hostProductRef: "B00000000000000000000006",
  extensionProductRef: "B00000000000000000000007",
  hostBuild: "C00000000000000000000001",
  hostBridgeBuild: "C00000000000000000000002",
  hostSubclassBuild: "C00000000000000000000003",
  credentialBuild: "C00000000000000000000004",
  extensionBridgeBuild: "C00000000000000000000005",
  embedBuild: "C00000000000000000000006",
  hostSources: "D00000000000000000000001",
  extensionSources: "D00000000000000000000002",
  embedPhase: "D00000000000000000000003",
  hostTarget: "E00000000000000000000001",
  extensionTarget: "E00000000000000000000002",
  releaseConfig: "F00000000000000000000001",
};

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

function list(values) {
  return values.map((value) => `\t\t\t\t${value},`).join("\n");
}

function pbxProject({
  extensionBuildFiles = [pbx.credentialBuild, pbx.extensionBridgeBuild],
  extensionBuildPhases = [pbx.extensionSources],
  extensionBridgeFileRef = pbx.extensionBridgeRef,
  hostBuildFiles = [pbx.hostBuild, pbx.hostBridgeBuild],
} = {}) {
  return `// !$*UTF8*$!
{
\tarchiveVersion = 1;
\tclasses = {};
\tobjectVersion = 56;
\tobjects = {

/* Begin PBXBuildFile section */
\t\t${pbx.hostBuild} /* Host.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${pbx.hostRef} /* Host.swift */; };
\t\t${pbx.hostBridgeBuild} /* RustCredentialBridge.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${pbx.hostBridgeRef} /* RustCredentialBridge.swift */; };
\t\t${pbx.hostSubclassBuild} /* HostCredentialProvider.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${pbx.hostSubclassRef} /* HostCredentialProvider.swift */; };
\t\t${pbx.credentialBuild} /* CredentialProviderViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${pbx.credentialRef} /* CredentialProviderViewController.swift */; };
\t\t${pbx.extensionBridgeBuild} /* RustCredentialBridge.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${extensionBridgeFileRef} /* RustCredentialBridge.swift */; };
\t\t${pbx.embedBuild} /* AutoFill.appex in Embed App Extensions */ = {isa = PBXBuildFile; fileRef = ${pbx.extensionProductRef} /* AutoFill.appex */; };
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
\t\t${pbx.hostRef} /* Host.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = Host.swift; sourceTree = "<group>"; };
\t\t${pbx.hostBridgeRef} /* RustCredentialBridge.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = RustCredentialBridge.swift; sourceTree = "<group>"; };
\t\t${pbx.hostSubclassRef} /* HostCredentialProvider.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = HostCredentialProvider.swift; sourceTree = "<group>"; };
\t\t${pbx.credentialRef} /* CredentialProviderViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = CredentialProviderViewController.swift; sourceTree = "<group>"; };
\t\t${pbx.extensionBridgeRef} /* RustCredentialBridge.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = RustCredentialBridge.swift; sourceTree = "<group>"; };
\t\t${pbx.hostProductRef} /* NianPass.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; path = NianPass.app; sourceTree = BUILT_PRODUCTS_DIR; };
\t\t${pbx.extensionProductRef} /* AutoFill.appex */ = {isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; path = AutoFill.appex; sourceTree = BUILT_PRODUCTS_DIR; };
/* End PBXFileReference section */

/* Begin PBXGroup section */
\t\t${pbx.mainGroup} = {isa = PBXGroup; children = (${pbx.hostGroup}, ${pbx.extensionGroup}, ${pbx.productsGroup},); sourceTree = "<group>"; };
\t\t${pbx.hostGroup} /* NianPass */ = {isa = PBXGroup; children = (${pbx.hostRef}, ${pbx.hostBridgeRef}, ${pbx.hostSubclassRef},); path = NianPass; sourceTree = "<group>"; };
\t\t${pbx.extensionGroup} /* AutoFill */ = {isa = PBXGroup; children = (${pbx.credentialRef}, ${pbx.extensionBridgeRef},); path = AutoFill; sourceTree = "<group>"; };
\t\t${pbx.productsGroup} /* Products */ = {isa = PBXGroup; children = (${pbx.hostProductRef}, ${pbx.extensionProductRef},); name = Products; sourceTree = "<group>"; };
/* End PBXGroup section */

/* Begin PBXSourcesBuildPhase section */
\t\t${pbx.hostSources} /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (
${list(hostBuildFiles)}
\t\t\t); runOnlyForDeploymentPostprocessing = 0; };
\t\t${pbx.extensionSources} /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (
${list(extensionBuildFiles)}
\t\t\t); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXSourcesBuildPhase section */

/* Begin PBXCopyFilesBuildPhase section */
\t\t${pbx.embedPhase} /* Embed App Extensions */ = {isa = PBXCopyFilesBuildPhase; dstSubfolderSpec = 13; files = (${pbx.embedBuild},); name = "Embed App Extensions"; };
/* End PBXCopyFilesBuildPhase section */

/* Begin PBXNativeTarget section */
\t\t${pbx.hostTarget} /* NianPass */ = {isa = PBXNativeTarget; buildPhases = (${pbx.hostSources}, ${pbx.embedPhase},); name = NianPass; productReference = ${pbx.hostProductRef}; productType = "com.apple.product-type.application"; };
\t\t${pbx.extensionTarget} /* AutoFill */ = {isa = PBXNativeTarget; buildPhases = (
${list(extensionBuildPhases)}
\t\t\t); name = AutoFill; productReference = ${pbx.extensionProductRef}; productType = "com.apple.product-type.app-extension"; };
/* End PBXNativeTarget section */

\t\t${pbx.releaseConfig} /* Release */ = {isa = XCBuildConfiguration; buildSettings = {IPHONEOS_DEPLOYMENT_TARGET = 14.0; }; name = Release; };
\t\t${pbx.project} /* Project object */ = {isa = PBXProject; mainGroup = ${pbx.mainGroup}; productRefGroup = ${pbx.productsGroup}; targets = (${pbx.hostTarget}, ${pbx.extensionTarget},); };
\t};
\trootObject = ${pbx.project} /* Project object */;
}
`;
}

function writeProject(root, options) {
  write(root, projectPath, pbxProject(options));
}

function ffiBridgeSource() {
  return `func exerciseReviewedRustFfi(handle: UInt64) {
    _ = np_ios_open_vault(nil, 0, nil, 0, nil, 0, 0, nil)
    _ = np_ios_copy_candidates_json(handle, nil, 0, nil)
    _ = np_ios_copy_identities_json(handle, nil, 0, nil)
    _ = np_ios_copy_credential(handle, nil, 0, nil, 0, nil)
    np_ios_free_buffer(nil, 0, 0)
    np_ios_free_secret_result(nil)
    _ = np_ios_close_vault(handle)
}
`;
}

function fixture(t, { includeSwift = true, projectOptions } = {}) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-ios-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeProject(root, projectOptions);
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
  write(root, bridgePath, ffiBridgeSource());
  write(root, hostBridgePath, "func hostOnlyBridgeHelper() {}\n");
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

test("provider subclass and multi-file Rust bridge in extension source phase pass", (t) => {
  const root = fixture(t);
  assert.deepEqual(runChecks(root), []);
});

test("all reviewed FFI calls only in the host target fail", (t) => {
  const root = fixture(t, {
    projectOptions: { extensionBuildFiles: [pbx.credentialBuild] },
  });
  write(root, hostBridgePath, ffiBridgeSource());
  assert.match(
    runChecks(root).join("\n"),
    /Credential Provider target Swift source must use np_ios_open_vault/u,
  );
});

test("unreferenced extension bridge and pbxproj comment membership fail", (t) => {
  const root = fixture(t, {
    projectOptions: { extensionBuildFiles: [pbx.credentialBuild] },
  });
  write(
    root,
    projectPath,
    `${readFileSync(join(root, projectPath), "utf8")}
// ${pbx.extensionBridgeBuild} /* RustCredentialBridge.swift in Sources */
`,
  );
  assert.match(
    runChecks(root).join("\n"),
    /Credential Provider target Swift source must use np_ios_open_vault/u,
  );
});

test("Credential Provider subclass only in the host target fails", (t) => {
  const root = fixture(t, {
    projectOptions: {
      hostBuildFiles: [
        pbx.hostBuild,
        pbx.hostBridgeBuild,
        pbx.hostSubclassBuild,
      ],
    },
  });
  replace(
    root,
    credentialPath,
    "ASCredentialProviderViewController",
    "NSObject",
  );
  write(
    root,
    hostSubclassPath,
    "final class HostCredentialProvider: ASCredentialProviderViewController {}\n",
  );
  assert.match(
    runChecks(root).join("\n"),
    /Credential Provider target Swift source is missing ASCredentialProviderViewController subclass/u,
  );
});

test("Credential Provider target without PBXSourcesBuildPhase fails", (t) => {
  const root = fixture(t, {
    projectOptions: { extensionBuildPhases: [] },
  });
  assert.match(
    runChecks(root).join("\n"),
    /Credential Provider target has no PBXSourcesBuildPhase/u,
  );
});

test("Xcode graph with no app-extension target fails", (t) => {
  const root = fixture(t);
  replace(
    root,
    projectPath,
    'productType = "com.apple.product-type.app-extension"',
    'productType = "com.apple.product-type.application"',
  );
  assert.match(
    runChecks(root).join("\n"),
    /exactly one app-extension PBXNativeTarget; found 0/u,
  );
});

test("Xcode graph with multiple app-extension targets fails", (t) => {
  const root = fixture(t);
  const secondTarget = "E00000000000000000000003";
  replace(
    root,
    projectPath,
    `\t\t${pbx.releaseConfig} /* Release */`,
    `\t\t${secondTarget} /* Other Extension */ = {isa = PBXNativeTarget; buildPhases = (${pbx.extensionSources},); name = OtherExtension; productReference = ${pbx.extensionProductRef}; productType = "com.apple.product-type.app-extension"; };\n\t\t${pbx.releaseConfig} /* Release */`,
  );
  replace(
    root,
    projectPath,
    `targets = (${pbx.hostTarget}, ${pbx.extensionTarget},);`,
    `targets = (${pbx.hostTarget}, ${pbx.extensionTarget}, ${secondTarget},);`,
  );
  assert.match(
    runChecks(root).join("\n"),
    /exactly one app-extension PBXNativeTarget; found 2/u,
  );
});

test("extension source phase with unknown build file fails", (t) => {
  const root = fixture(t, {
    projectOptions: {
      extensionBuildFiles: [pbx.credentialBuild, "DEAD00000000000000000002"],
    },
  });
  assert.match(
    runChecks(root).join("\n"),
    /Credential Provider target references unknown PBXBuildFile DEAD00000000000000000002/u,
  );
});

test("extension build file with missing file reference fails", (t) => {
  const root = fixture(t, {
    projectOptions: {
      extensionBridgeFileRef: "DEAD00000000000000000001",
    },
  });
  assert.match(
    runChecks(root).join("\n"),
    /Credential Provider target references unresolved source file DEAD00000000000000000001/u,
  );
});

test("test Swift in extension source phase cannot satisfy production policy", (t) => {
  const root = fixture(t);
  replace(
    root,
    projectPath,
    `${pbx.extensionBridgeRef} /* RustCredentialBridge.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = RustCredentialBridge.swift; sourceTree = "<group>"; };`,
    `${pbx.extensionBridgeRef} /* RustCredentialBridgeTests.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = RustCredentialBridgeTests.swift; sourceTree = "<group>"; };`,
  );
  write(
    root,
    `${apple}/AutoFill/RustCredentialBridgeTests.swift`,
    ffiBridgeSource(),
  );
  assert.match(
    runChecks(root).join("\n"),
    /must not include non-production Swift source AutoFill\/RustCredentialBridgeTests\.swift/u,
  );
});

test("duplicate host and extension bridge basenames resolve by PBX group path", (t) => {
  const root = fixture(t);
  write(
    root,
    hostBridgePath,
    "func hostRustCredentialBridgeWithoutReviewedCalls() {}\n",
  );
  assert.deepEqual(runChecks(root), []);
});

test("unrelated global Swift FFI call cannot rescue extension source", (t) => {
  const root = fixture(t);
  replace(
    root,
    bridgePath,
    "_ = np_ios_copy_credential(handle, nil, 0, nil, 0, nil)",
    "_ = missing_np_ios_copy_credential(handle)",
  );
  write(
    root,
    hostBridgePath,
    "func hostOnlyCredentialCall() { _ = np_ios_copy_credential(nil, 0, nil, 0, nil) }\n",
  );
  assert.match(
    runChecks(root).join("\n"),
    /Credential Provider target Swift source must use np_ios_copy_credential/u,
  );
});

test("SOURCE_ROOT extension file reference resolves inside Apple project", (t) => {
  const root = fixture(t);
  replace(
    root,
    projectPath,
    `${pbx.extensionBridgeRef} /* RustCredentialBridge.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = RustCredentialBridge.swift; sourceTree = "<group>"; };`,
    `${pbx.extensionBridgeRef} /* RustCredentialBridge.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = AutoFill/RustCredentialBridge.swift; sourceTree = SOURCE_ROOT; };`,
  );
  assert.deepEqual(runChecks(root), []);
});

test("extension Swift source traversal outside Apple project fails", (t) => {
  const root = fixture(t);
  replace(
    root,
    projectPath,
    `${pbx.extensionBridgeRef} /* RustCredentialBridge.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = RustCredentialBridge.swift; sourceTree = "<group>"; };`,
    `${pbx.extensionBridgeRef} /* RustCredentialBridge.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ../../Outside.swift; sourceTree = SOURCE_ROOT; };`,
  );
  assert.match(
    runChecks(root).join("\n"),
    /resolves outside the Apple project/u,
  );
});

test("behavioral markers only in project.pbxproj cannot fake Swift", (t) => {
  const root = fixture(t, { includeSwift: false });
  write(
    root,
    projectPath,
    `${readFileSync(join(root, projectPath), "utf8")}
// ASCredentialProviderViewController UIDocumentPickerViewController NSFileCoordinator
// startAccessingSecurityScopedResource stopAccessingSecurityScopedResource
// provideCredentialWithoutUserInteraction userInteractionRequired prepareCredentialList
// prepareInterfaceToProvideCredential ASPasswordCredential cancelRequest
// np_ios_open_vault() np_ios_copy_candidates_json() np_ios_copy_identities_json()
// np_ios_copy_credential() np_ios_free_buffer() np_ios_free_secret_result() np_ios_close_vault()
`,
  );
  assert.match(
    runChecks(root).join("\n"),
    /Credential Provider target Swift source is missing ASCredentialProviderViewController subclass/u,
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
    /Credential Provider target Swift source is missing ASCredentialProviderViewController subclass/u,
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
