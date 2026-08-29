import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  hasSwiftCall,
  stripSwiftComments,
  swiftExecutableText,
  synchronizablePolicy,
} from "./lib/swift_source_policy.mjs";
import {
  credentialProviderSwiftPaths,
  stripPbxComments,
} from "./lib/pbx_source_policy.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const appleRoot = "apps/desktop/src-tauri/gen/apple";

const ffiSymbols = [
  "np_ios_open_vault",
  "np_ios_copy_candidates_json",
  "np_ios_copy_identities_json",
  "np_ios_copy_credential",
  "np_ios_close_vault",
  "np_ios_free_buffer",
  "np_ios_free_secret_result",
];

const credentialApis = [
  "provideCredentialWithoutUserInteraction",
  "userInteractionRequired",
  "prepareCredentialList",
  "prepareInterfaceToProvideCredential",
  "ASPasswordCredential",
  "cancelRequest",
];

const hostApis = [
  "UIDocumentPickerViewController",
  "startAccessingSecurityScopedResource",
  "stopAccessingSecurityScopedResource",
  "NSFileCoordinator",
];

const nativeIntegrationMarkers = [
  "FileProtectionType.complete",
  "ASCredentialIdentityStore",
  "ASPasswordCredentialIdentity",
];

const forbiddenSwiftFeatures = [
  "ProvidesPasskeys",
  "ProvidesOneTimeCodes",
  "ASPasskeyCredentialRequest",
  "ASOneTimeCodeCredentialRequest",
  "ASSavePasswordRequest",
  "WKWebView",
  "UserDefaults",
  "identities.json",
  "entries.json",
  "autofill-index.json",
];

const duplicateBackendPatterns = [
  ["KdbxParser/KDBXParser", /\bKDBXParser\b/iu],
  ["DatabaseKey", /\bDatabaseKey\b/u],
  ["CompositeKey", /\bCompositeKey\b/u],
  ["Argon2", /\bArgon2(?:d|id)?\b/iu],
  ["AES-KDF implementation", /\b(?:AESKdf|AESKDF|AesKdf)\b/u],
  ["KeePassDatabase", /\bKeePassDatabase\b/iu],
  ["KeePassParser", /\bKeePassParser\b/iu],
];

function collectFiles(directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) collectFiles(path, result);
    else result.push(path);
  }
  return result;
}

function isProductionSwift(path) {
  const parts = path.split(/[\\/]/u);
  return !parts.some(
    (part) =>
      /(?:Tests?|UITests?)$/iu.test(part) ||
      /(?:Tests?|UITests?|Spec)\.swift$/iu.test(part),
  );
}

function classifyFiles(project) {
  const groups = { swift: [], entitlements: [], plist: [], pbxproj: [] };
  for (const path of collectFiles(project)) {
    let category = null;
    if (path.endsWith(".swift") && isProductionSwift(relative(project, path)))
      category = "swift";
    else if (path.endsWith(".entitlements")) category = "entitlements";
    else if (path.endsWith(".plist")) category = "plist";
    else if (basename(path) === "project.pbxproj") category = "pbxproj";
    if (category !== null) {
      groups[category].push({ path, source: readFileSync(path, "utf8") });
    }
  }
  return groups;
}

function withoutXmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/gu, "");
}

function hasTruePlistKey(source, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?:<key>\\s*${escaped}\\s*</key>\\s*<true\\s*/>|\\b${escaped}\\b\\s*=\\s*(?:true|YES)\\b)`,
    "iu",
  ).test(source);
}

function validateBuildGraph(groups, violations) {
  const graph = groups.pbxproj
    .map(({ source }) => stripPbxComments(source))
    .join("\n");
  if (groups.pbxproj.length === 0) {
    violations.push(`${appleRoot}: real Xcode build graph is missing`);
    return;
  }
  if (!/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*14\.0\s*;/u.test(graph)) {
    violations.push(
      "iOS Xcode build graph must set IPHONEOS_DEPLOYMENT_TARGET = 14.0",
    );
  }
  if (
    !/productType\s*=\s*["']?com\.apple\.product-type\.app-extension["']?\s*;/u.test(
      graph,
    )
  ) {
    violations.push(
      "iOS Xcode build graph must define a Credential Provider extension target",
    );
  }
  if (
    !/\.appex\b/u.test(graph) ||
    !/(?:Embed App Extensions|dstSubfolderSpec\s*=\s*13)/u.test(graph)
  ) {
    violations.push(
      "iOS Xcode build graph must embed the Credential Provider .appex in the host app",
    );
  }
}

function validateSwift(project, groups, credentialPaths, violations) {
  const byPath = new Map(
    groups.swift.map((record) => [
      relative(project, record.path).replaceAll("\\", "/"),
      record,
    ]),
  );
  const credentialSwift = [];
  for (const path of credentialPaths ?? []) {
    if (!isProductionSwift(path)) {
      violations.push(
        `Credential Provider target must not include non-production Swift source ${path}`,
      );
      continue;
    }
    const record = byPath.get(path);
    if (!record) {
      violations.push(
        `Credential Provider target references missing Swift source ${path}`,
      );
      continue;
    }
    credentialSwift.push(record);
  }
  const commentsStripped = groups.swift
    .map(({ source }) => stripSwiftComments(source))
    .join("\n");
  const executable = groups.swift
    .map(({ source }) => swiftExecutableText(source))
    .join("\n");
  const credentialExecutable = credentialSwift
    .map(({ source }) => swiftExecutableText(source))
    .join("\n");
  const credentialSubclass =
    /\bclass\s+[A-Za-z_]\w*(?:\s*<[^>{}]*>)?\s*:\s*[^{}]*\bASCredentialProviderViewController\b/u;

  if (
    credentialPaths !== null &&
    !credentialSubclass.test(credentialExecutable)
  ) {
    violations.push(
      "Credential Provider target Swift source is missing ASCredentialProviderViewController subclass",
    );
  }
  for (const symbol of credentialPaths === null ? [] : ffiSymbols) {
    if (!hasSwiftCall(credentialExecutable, symbol)) {
      violations.push(
        `Credential Provider target Swift source must use ${symbol}`,
      );
    }
  }
  for (const marker of credentialPaths === null ? [] : credentialApis) {
    if (!credentialExecutable.includes(marker)) {
      violations.push(
        `Credential Provider target Swift source is missing ${marker}`,
      );
    }
  }
  for (const marker of [...hostApis, ...nativeIntegrationMarkers]) {
    if (!executable.includes(marker))
      violations.push(`iOS production Swift source is missing ${marker}`);
  }
  if (
    !/\bcontainerURL\s*\(\s*forSecurityApplicationGroupIdentifier\s*:/u.test(
      executable,
    )
  ) {
    violations.push(
      "iOS production Swift source is missing App Group containerURL usage",
    );
  }
  if (!commentsStripped.includes("AutoFill/vault.kdbx")) {
    violations.push(
      "iOS production Swift source is missing the fixed AutoFill/vault.kdbx mirror name",
    );
  }
  if (!executable.includes("kSecAttrAccessibleWhenUnlockedThisDeviceOnly")) {
    violations.push(
      "iOS Keychain Swift source must use kSecAttrAccessibleWhenUnlockedThisDeviceOnly",
    );
  }
  const synchronizable = synchronizablePolicy(executable);
  if (synchronizable.hasTrue) {
    violations.push(
      "iOS Keychain Swift source must reject kSecAttrSynchronizable=true",
    );
  } else if (!synchronizable.hasFalse) {
    violations.push(
      "iOS Keychain Swift source must set kSecAttrSynchronizable to false or kCFBooleanFalse",
    );
  }
  for (const forbidden of forbiddenSwiftFeatures) {
    if (commentsStripped.includes(forbidden))
      violations.push(`M5.4 iOS Swift source must not contain ${forbidden}`);
  }
  for (const [name, pattern] of duplicateBackendPatterns) {
    if (pattern.test(executable))
      violations.push(
        `M5.4 Swift must not implement a duplicate KDBX backend (${name})`,
      );
  }
}

function validateEntitlements(groups, violations) {
  const sources = groups.entitlements.map(({ source }) =>
    withoutXmlComments(source),
  );
  if (sources.length < 2)
    violations.push(
      "M5.4 requires host and Credential Provider entitlement files",
    );
  for (const key of [
    "com.apple.developer.authentication-services.autofill-credential-provider",
    "com.apple.security.application-groups",
    "keychain-access-groups",
  ]) {
    if (sources.filter((source) => source.includes(key)).length < 2) {
      violations.push(
        `iOS host and Credential Provider entitlements must both contain ${key}`,
      );
    }
  }
}

function validatePlists(groups, violations) {
  const extensionPlists = groups.plist
    .map(({ source }) => withoutXmlComments(source))
    .filter(
      (source) =>
        source.includes(
          "com.apple.authentication-services-credential-provider-ui",
        ) ||
        source.includes("ASCredentialProviderExtensionCapabilities") ||
        source.includes("ProvidesPasswords"),
    );
  if (extensionPlists.length === 0) {
    violations.push("iOS Credential Provider Info.plist is missing");
    return;
  }
  if (
    !extensionPlists.some((source) =>
      source.includes(
        "com.apple.authentication-services-credential-provider-ui",
      ),
    )
  ) {
    violations.push(
      "iOS Credential Provider Info.plist has the wrong extension point",
    );
  }
  if (
    !extensionPlists.some((source) =>
      hasTruePlistKey(source, "ProvidesPasswords"),
    )
  ) {
    violations.push(
      "iOS Credential Provider Info.plist must set ProvidesPasswords=true",
    );
  }
  for (const forbidden of ["ProvidesPasskeys", "ProvidesOneTimeCodes"]) {
    if (extensionPlists.some((source) => source.includes(forbidden))) {
      violations.push(
        `Password-only iOS Credential Provider plist must not contain ${forbidden}`,
      );
    }
  }
}

export function runChecks(root = repositoryRoot) {
  const project = resolve(root, appleRoot);
  if (!existsSync(project))
    return [`${appleRoot}: official Tauri Apple project is missing`];

  const violations = [];
  const groups = classifyFiles(project);
  validateBuildGraph(groups, violations);
  let credentialPaths = null;
  if (groups.pbxproj.length > 0) {
    try {
      credentialPaths = credentialProviderSwiftPaths(
        groups.pbxproj.map(({ source }) => source),
      );
    } catch (error) {
      violations.push(
        error instanceof Error
          ? error.message
          : "Unable to resolve Credential Provider PBX source membership",
      );
    }
  }
  validateSwift(project, groups, credentialPaths, violations);
  validateEntitlements(groups, violations);
  validatePlists(groups, violations);
  return violations;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const violations = runChecks();
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`${violation}\n`);
    process.exitCode = 1;
  }
}
