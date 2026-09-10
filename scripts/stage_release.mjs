import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalReleaseAssetName } from "./release_asset_name.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "artifacts/release");
const accepted = /\.(?:AppImage|apk|deb|msi|rpm|exe)$/i;

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const defaultRoots = [
  resolve(root, "target/release/bundle"),
  resolve(root, "target/x86_64-pc-windows-msvc/release/bundle"),
  resolve(root, "apps/desktop/src-tauri/target/release/bundle"),
  resolve(root, "apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle"),
  resolve(root, "apps/desktop/src-tauri/gen/android/app/build/outputs/apk"),
];

export function stageReleaseArtifacts(roots, destination) {
  const artifacts = roots.flatMap(walk).filter((item) => accepted.test(item));
  if (artifacts.length === 0) {
    throw new Error("No desktop or Android release artifacts were found to stage");
  }
  const destinations = new Map();
  for (const path of artifacts) {
    const name = canonicalReleaseAssetName(basename(path));
    const existing = destinations.get(name);
    if (existing) {
      throw new Error(`canonical release asset filename collision ${name}: ${existing} and ${path}`);
    }
    destinations.set(name, path);
  }
  mkdirSync(destination, { recursive: true });
  for (const [name, path] of [...destinations].sort(([left], [right]) => left.localeCompare(right))) {
    const legacyName = basename(path);
    if (legacyName !== name) rmSync(resolve(destination, legacyName), { force: true });
    copyFileSync(path, resolve(destination, name));
  }
  return [...destinations.keys()].sort((left, right) => left.localeCompare(right));
}

function main() {
  const staged = stageReleaseArtifacts(defaultRoots, output);
  process.stdout.write(`Staged ${staged.length} desktop/Android release artifact(s).\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Release staging failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
