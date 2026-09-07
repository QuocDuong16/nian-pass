import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { deterministicZip } from "../apps/browser-extension/build/package.mjs";

const root = resolve(import.meta.dirname, "..");

export function buildNativeHostArchive(platform, binaryBytes, version) {
  if (!["linux-x86_64", "windows-x86_64"].includes(platform)) {
    throw new Error(`unsupported native host platform ${platform}`);
  }
  const expectedName = platform.startsWith("windows") ? "nian-pass-browser-host.exe" : "nian-pass-browser-host";
  const instructions = `Nian Pass Native Messaging host ${version} (${platform})

Place ${expectedName} in a stable, user-owned application directory.
Install manifests: ${expectedName} install all
Verify registration: ${expectedName} doctor all
Before upgrade: close browsers, replace the binary, then rerun install all.
Uninstall manifests: ${expectedName} uninstall all

The host is Nian Pass transport, not KeePassXC or keepassxc-proxy.
Production browser store IDs require a matching production host build.
`;
  return deterministicZip([
    {
      name: expectedName,
      bytes: binaryBytes,
      mode: platform.startsWith("linux") ? 0o755 : 0o644,
    },
    { name: "INSTALL.txt", bytes: Buffer.from(instructions), mode: 0o644 },
  ]);
}

function main() {
  const [platform, binaryArgument] = process.argv.slice(2);
  if (!["linux-x86_64", "windows-x86_64"].includes(platform) || !binaryArgument) {
    process.stderr.write("usage: package_native_host.mjs linux-x86_64|windows-x86_64 BINARY\n");
    process.exitCode = 2;
    return;
  }
  const binary = resolve(binaryArgument);
  const expectedName = platform.startsWith("windows") ? "nian-pass-browser-host.exe" : "nian-pass-browser-host";
  if (basename(binary) !== expectedName) {
    throw new Error(`native host binary must be named ${expectedName}`);
  }
  const version = readFileSync(resolve(root, "VERSION"), "utf8").trim();
  const archive = buildNativeHostArchive(platform, readFileSync(binary), version);
  const output = resolve(root, "artifacts/release");
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, `nian-pass-native-host-${platform}-${version}.zip`), archive);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
