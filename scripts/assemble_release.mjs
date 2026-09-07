import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..");

function matches(name, pattern) {
  pattern.lastIndex = 0;
  return pattern.test(name);
}

const platformPolicy = (version) => ({
  windows: [
    { pattern: new RegExp(`^nian-pass-native-host-windows-x86_64-${version.replaceAll(".", "\\.")}\\.zip$`), count: 1 },
    { pattern: /\.exe$/i, minimum: 1 },
  ],
  linux: [
    { pattern: new RegExp(`^nian-pass-native-host-linux-x86_64-${version.replaceAll(".", "\\.")}\\.zip$`), count: 1 },
    { pattern: /\.AppImage$/, minimum: 1 },
    { pattern: /\.deb$/i, minimum: 1 },
  ],
  browser: [
    { pattern: new RegExp(`^nian-pass-browser-chromium-${version.replaceAll(".", "\\.")}\\.zip$`), count: 1 },
    { pattern: new RegExp(`^nian-pass-browser-firefox-${version.replaceAll(".", "\\.")}\\.zip$`), count: 1 },
  ],
  android: [{ pattern: /\.apk$/i, minimum: 1 }],
  gateway: [
    { pattern: /^gateway-image\.json$/, count: 1 },
    { pattern: new RegExp(`^nian-pass-sync-gateway-${version.replaceAll(".", "\\.")}\\.tar\\.gz$`), count: 1 },
  ],
});

export function assembleReleaseSet(inputRoot, outputRoot, version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("release assembly requires one semantic version");
  }
  const policy = platformPolicy(version);
  const staged = [];
  const seen = new Set();

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  for (const [platform, requirements] of Object.entries(policy)) {
    const platformRoot = resolve(inputRoot, platform);
    const rootInfo = lstatSync(platformRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new Error(`${platform}: payload root must be a real directory`);
    }
    const entries = readdirSync(platformRoot, { withFileTypes: true });
    const files = entries.map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(`${platform}/${entry.name}: nested paths and links are forbidden`);
      }
      const matched = requirements.filter(({ pattern }) => matches(entry.name, pattern));
      if (matched.length !== 1) throw new Error(`${platform}/${entry.name}: unexpected release payload`);
      return entry.name;
    });
    for (const requirement of requirements) {
      const count = files.filter((name) => matches(name, requirement.pattern)).length;
      if (requirement.count !== undefined && count !== requirement.count) {
        throw new Error(`${platform}: expected ${requirement.count} payload matching ${requirement.pattern}, found ${count}`);
      }
      if (requirement.minimum !== undefined && count < requirement.minimum) {
        throw new Error(`${platform}: expected at least ${requirement.minimum} payload matching ${requirement.pattern}, found ${count}`);
      }
    }
    for (const name of files.sort((left, right) => left.localeCompare(right))) {
      const outputName = basename(name);
      if (seen.has(outputName)) throw new Error(`duplicate release payload name ${outputName}`);
      seen.add(outputName);
      copyFileSync(resolve(platformRoot, name), resolve(outputRoot, outputName));
      staged.push(outputName);
    }
  }
  return staged;
}

function main() {
  const inputRoot = resolve(process.env.RELEASE_PAYLOAD_DIR ?? resolve(repositoryRoot, "artifacts/platforms"));
  const outputRoot = resolve(process.env.ARTIFACT_DIR ?? resolve(repositoryRoot, "artifacts/release"));
  const version = process.env.RELEASE_VERSION ?? "";
  const staged = assembleReleaseSet(inputRoot, outputRoot, version);
  process.stdout.write(`Assembled ${staged.length} canonical release payload(s).\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Release assembly failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
