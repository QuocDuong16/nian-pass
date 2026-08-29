import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..");
const appleRoot = "apps/desktop/src-tauri/gen/apple";

function sourceFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...sourceFiles(path));
    else if (/\.(?:swift|entitlements|plist|pbxproj|yml)$/u.test(entry.name)) result.push(path);
  }
  return result;
}

export function runChecks(root = repositoryRoot) {
  const violations = [];
  const project = resolve(root, appleRoot);
  if (!existsSync(project)) {
    return [`${appleRoot}: official Tauri Apple project is missing`];
  }
  const candidates = sourceFiles(project);
  if (candidates.length === 0) {
    violations.push(`${appleRoot}: real Xcode build graph is missing`);
  }
  const source = candidates.map((path) => readFileSync(path, "utf8")).join("\n");
  for (const required of [
    "IPHONEOS_DEPLOYMENT_TARGET = 14.0",
    "ASCredentialProviderViewController",
    "UIDocumentPickerViewController",
    "startAccessingSecurityScopedResource",
    "stopAccessingSecurityScopedResource",
    "NSFileCoordinator",
    "containerURL(forSecurityApplicationGroupIdentifier:",
    "FileProtectionType.complete",
    "AutoFill/vault.kdbx",
    "kSecAttrAccessibleWhenUnlockedThisDeviceOnly",
    "kSecAttrSynchronizable",
    "ASCredentialIdentityStore",
    "ASPasswordCredentialIdentity",
    "provideCredentialWithoutUserInteraction",
    "userInteractionRequired",
    "prepareCredentialList",
    "prepareInterfaceToProvideCredential",
    "ASPasswordCredential",
    "cancelRequest",
    "com.apple.developer.authentication-services.autofill-credential-provider",
    "com.apple.security.application-groups",
    "keychain-access-groups",
    "ProvidesPasswords",
  ]) {
    if (!source.includes(required)) violations.push(`iOS source/build graph is missing ${required}`);
  }
  for (const forbidden of [
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
  ]) {
    if (source.includes(forbidden)) violations.push(`M5.4 iOS source must not contain ${forbidden}`);
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = runChecks();
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`${violation}\n`);
    process.exitCode = 1;
  }
}
