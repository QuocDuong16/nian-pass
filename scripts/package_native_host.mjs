import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { deterministicZip } from "../apps/browser-extension/build/package.mjs";

const root = resolve(import.meta.dirname, "..");
const [platform, binaryArgument] = process.argv.slice(2);
if (!['linux-x86_64', 'windows-x86_64'].includes(platform) || !binaryArgument) {
  process.stderr.write("usage: package_native_host.mjs linux-x86_64|windows-x86_64 BINARY\n");
  process.exit(2);
}
const binary = resolve(binaryArgument);
const expectedName = platform.startsWith("windows")
  ? "nian-pass-browser-host.exe"
  : "nian-pass-browser-host";
if (basename(binary) !== expectedName) {
  throw new Error(`native host binary must be named ${expectedName}`);
}
const version = readFileSync(resolve(root, "VERSION"), "utf8").trim();
const instructions = `Nian Pass Native Messaging host ${version} (${platform})

Place ${expectedName} in a stable, user-owned application directory.
Install manifests: ${expectedName} install all
Verify registration: ${expectedName} doctor all
Before upgrade: close browsers, replace the binary, then rerun install all.
Uninstall manifests: ${expectedName} uninstall all

The host is Nian Pass transport, not KeePassXC or keepassxc-proxy.
Production browser store IDs require a matching production host build.
`;
const archive = deterministicZip([
  { name: expectedName, bytes: readFileSync(binary) },
  { name: "INSTALL.txt", bytes: Buffer.from(instructions) },
]);
const output = resolve(root, "artifacts/release");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, `nian-pass-native-host-${platform}-${version}.zip`), archive);
