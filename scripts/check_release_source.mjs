import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parse as parseToml } from "smol-toml";

const repositoryRoot = resolve(import.meta.dirname, "..");
const versionFiles = [
  ["apps/cli/Cargo.toml", "toml"],
  ["apps/browser-native-host/Cargo.toml", "toml"],
  ["apps/desktop/src-tauri/Cargo.toml", "toml"],
  ["apps/sync-gateway/Cargo.toml", "toml"],
  ["apps/desktop/package.json", "json"],
  ["apps/browser-extension/package.json", "json"],
  ["apps/desktop/src-tauri/tauri.conf.json", "json"],
];

function read(root, name) {
  return readFileSync(resolve(root, name), "utf8");
}

export function releaseVersion(root) {
  const version = read(root, "VERSION").trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("VERSION must contain one semantic version");
  }
  return version;
}

function dependencyRequirement(value) {
  return typeof value === "string" ? value : value?.version;
}

export function isExactVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function checkCargoPins(root, violations) {
  const workspace = parseToml(read(root, "Cargo.toml"));
  const manifests = ["Cargo.toml", ...workspace.workspace.members.map((item) => `${item}/Cargo.toml`)];
  for (const name of manifests) {
    const manifest = parseToml(read(root, name));
    for (const section of ["dependencies", "dev-dependencies", "build-dependencies"]) {
      for (const [dependency, value] of Object.entries(manifest[section] ?? {})) {
        const requirement = dependencyRequirement(value);
        if (requirement !== undefined && !requirement.startsWith("=")) {
          violations.push(`${name}: ${section}.${dependency} must use an exact = version`);
        }
        if (typeof value === "object" && value !== null && "git" in value) {
          violations.push(`${name}: ${section}.${dependency} may not use a git source`);
        }
      }
    }
  }
}

export function sourcePolicyViolations(root) {
  const violations = [];
  let version;
  try {
    version = releaseVersion(root);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  for (const [name, kind] of versionFiles) {
    if (!existsSync(resolve(root, name))) {
      violations.push(`${name}: user-facing version source is missing`);
      continue;
    }
    const data = kind === "toml" ? parseToml(read(root, name)) : JSON.parse(read(root, name));
    const declared = kind === "toml" ? data.package?.version : data.version;
    if (declared !== version) violations.push(`${name}: version ${String(declared)} != ${version}`);
  }

  const rootPackage = JSON.parse(read(root, "package.json"));
  const nodeVersion = read(root, ".node-version").trim();
  const mise = parseToml(read(root, ".mise.toml"));
  const rustToolchain = parseToml(read(root, "rust-toolchain.toml"));
  const workspace = parseToml(read(root, "Cargo.toml"));
  if (rootPackage.engines?.node !== nodeVersion || mise.tools?.node !== nodeVersion) {
    violations.push("Node pins in package.json, .node-version, and .mise.toml must match");
  }
  const rustVersion = mise.tools?.rust;
  if (
    rustToolchain.toolchain?.channel !== rustVersion ||
    workspace.workspace?.package?.["rust-version"] !== rustVersion
  ) {
    violations.push("Rust pins in Cargo.toml, rust-toolchain.toml, and .mise.toml must match");
  }
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(rootPackage.packageManager ?? "")) {
    violations.push("packageManager must pin one exact pnpm version");
  }

  for (const name of ["package.json", "apps/desktop/package.json", "apps/browser-extension/package.json"]) {
    const manifest = JSON.parse(read(root, name));
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [dependency, requirement] of Object.entries(manifest[section] ?? {})) {
        if (!isExactVersion(requirement)) {
          violations.push(`${name}: ${section}.${dependency} must use an exact version`);
        }
      }
    }
  }
  for (const lockfile of ["Cargo.lock", "pnpm-lock.yaml"]) {
    if (!existsSync(resolve(root, lockfile))) violations.push(`${lockfile}: release lockfile is missing`);
  }
  const androidBuild = read(root, "apps/desktop/src-tauri/gen/android/app/build.gradle.kts");
  if (!androidBuild.includes('ndkVersion = "28.2.13676358"')) {
    violations.push("Android NDK must be pinned to 28.2.13676358");
  }
  const gradleWrapper = read(root, "apps/desktop/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties");
  if (!/^distributionSha256Sum=[0-9a-f]{64}$/m.test(gradleWrapper)) {
    violations.push("Gradle distribution must have an exact SHA-256 pin");
  }
  const releaseProfile = workspace.profile?.release;
  if (
    releaseProfile?.["codegen-units"] !== 1 ||
    releaseProfile?.lto !== "thin" ||
    releaseProfile?.["overflow-checks"] !== true ||
    releaseProfile?.strip !== "symbols"
  ) {
    violations.push("Cargo release hardening profile is incomplete");
  }
  const denyPolicy = parseToml(read(root, "deny.toml"));
  if (denyPolicy.advisories?.yanked !== "deny") {
    violations.push("cargo-deny must reject yanked Rust packages");
  }

  checkCargoPins(root, violations);
  for (const workflow of [".forgejo/workflows/quality.yml", ".forgejo/workflows/openwiki-update.yml", ".forgejo/workflows/release.yml"]) {
    if (!existsSync(resolve(root, workflow))) continue;
    for (const match of read(root, workflow).matchAll(/^\s*uses:\s*(\S+)/gm)) {
      if (!/@[0-9a-f]{40}$/.test(match[1])) {
        violations.push(`${workflow}: action ${match[1]} must use a full commit revision`);
      }
    }
    for (const match of read(root, workflow).matchAll(/^\s*image:\s*(\S+)/gm)) {
      if (!/@sha256:[0-9a-f]{64}$/.test(match[1])) {
        violations.push(`${workflow}: container ${match[1]} must use a sha256 digest`);
      }
    }
  }
  for (const dockerfile of ["apps/sync-gateway/Dockerfile"]) {
    for (const match of read(root, dockerfile).matchAll(/^FROM\s+(\S+)/gm)) {
      if (!/@sha256:[0-9a-f]{64}$/.test(match[1])) {
        violations.push(`${dockerfile}: base image ${match[1]} must use a sha256 digest`);
      }
    }
  }
  return violations;
}

export function tagViolation(root, tag) {
  const expected = `v${releaseVersion(root)}`;
  return tag === expected ? null : `release tag ${tag || "<missing>"} != ${expected}`;
}

function gitCommit(root, revision) {
  const result = spawnSync("git", ["rev-parse", "--verify", revision], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function tagIdentityViolation(root, tag) {
  const tagRevision = `refs/tags/${tag}^{commit}`;
  const tagCommit = gitCommit(root, tagRevision);
  if (!tagCommit) return `release tag refs/tags/${tag} does not exist or does not resolve to a commit`;
  const headCommit = gitCommit(root, "HEAD");
  if (!headCommit) return "could not resolve the release HEAD commit";
  return tagCommit === headCommit
    ? null
    : `release tag refs/tags/${tag} points to ${tagCommit}, not HEAD ${headCommit}`;
}

export function dirtyTreeViolation(root) {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) return "could not inspect the Git working tree";
  return result.stdout.trim() === "" ? null : "release source tree contains uncommitted changes";
}

function main() {
  const modes = new Set(process.argv.slice(2));
  const violations = sourcePolicyViolations(repositoryRoot);
  if (modes.has("--clean")) {
    const dirty = dirtyTreeViolation(repositoryRoot);
    if (dirty) violations.push(dirty);
  }
  if (modes.has("--tag")) {
    const tag = process.env.RELEASE_TAG ?? "";
    const mismatch = tagViolation(repositoryRoot, tag);
    if (mismatch) violations.push(mismatch);
    else {
      const identity = tagIdentityViolation(repositoryRoot, tag);
      if (identity) violations.push(identity);
    }
  }
  if (violations.length > 0) {
    process.stderr.write(`Release source check failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Release source check passed.\n");
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
