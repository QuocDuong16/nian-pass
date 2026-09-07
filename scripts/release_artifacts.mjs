import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync, zstdDecompressSync } from "node:zlib";

const repositoryRoot = resolve(import.meta.dirname, "..");
const defaultArtifactRoot = resolve(repositoryRoot, "artifacts/release");
const metadataNames = new Set(["SHA256SUMS", "release-manifest.json", "sbom.cdx.json"]);
const forbiddenNames = /(?:^|\/)(?:\.env(?:\..*)?|coverage(?:\/|$)|[^/]+\.(?:kdbx|pem|p12|pfx|key|map))$/i;
const secretSentinels = [
  "M8_RELEASE_SECRET",
  "M6_ARTIFACT_SECRET_MARKER",
  "SECRET_MUST_NOT_BE_READ",
  "correct horse battery staple",
  "synthetic-gateway-token",
];
const assignment = /(?:PASSWORD|TOKEN|SECRET|PRIVATE_KEY|ACCESS_KEY)\s*=\s*[^\s"']+/i;
const maximumExpandedArchiveBytes = 512 * 1024 * 1024;

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function payloadFiles(root) {
  return walk(root)
    .filter((path) => !metadataNames.has(basename(path)))
    .sort((left, right) => left.localeCompare(right));
}

function zipEntries(bytes) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameSize = bytes.readUInt16LE(offset + 26);
    const extraSize = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const bodyStart = nameStart + nameSize + extraSize;
    const name = bytes.subarray(nameStart, nameStart + nameSize).toString("utf8");
    if (method !== 0 || bodyStart + size > bytes.length) {
      throw new Error(`ZIP entry ${name} is not an inspectable stored entry`);
    }
    entries.push({ name, bytes: bytes.subarray(bodyStart, bodyStart + size) });
    offset = bodyStart + size;
  }
  return entries;
}

function tarEntries(bytes) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "")
        .trim();
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join("/");
    const sizeField = field(124, 12);
    const checksumField = header
      .subarray(148, 156)
      .toString("ascii")
      .replace(/[\0 ]+$/g, "")
      .trim();
    if (!name || !/^[0-7]+$/.test(sizeField) || !/^[0-7]+$/.test(checksumField)) {
      throw new Error("TAR contains an invalid header");
    }
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (actualChecksum !== Number.parseInt(checksumField, 8)) {
      throw new Error(`TAR entry ${name} has an invalid header checksum`);
    }
    const size = Number.parseInt(sizeField, 8);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (!Number.isSafeInteger(size) || bodyEnd > bytes.length) {
      throw new Error(`TAR entry ${name} exceeds its archive bounds`);
    }
    entries.push({ name, type: String.fromCharCode(header[156] ?? 0), bytes: bytes.subarray(bodyStart, bodyEnd) });
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function arEntries(bytes) {
  if (bytes.subarray(0, 8).toString("ascii") !== "!<arch>\n") {
    throw new Error("Debian archive has an invalid ar signature");
  }
  const entries = [];
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 60 > bytes.length) throw new Error("Debian archive has a truncated ar header");
    const header = bytes.subarray(offset, offset + 60);
    if (header.subarray(58, 60).toString("ascii") !== "`\n") {
      throw new Error("Debian archive has an invalid ar header");
    }
    const name = header.subarray(0, 16).toString("utf8").trim().replace(/\/$/, "");
    const sizeField = header.subarray(48, 58).toString("ascii").trim();
    if (!name || !/^\d+$/.test(sizeField)) throw new Error("Debian archive has invalid ar metadata");
    const size = Number.parseInt(sizeField, 10);
    const bodyStart = offset + 60;
    const bodyEnd = bodyStart + size;
    if (!Number.isSafeInteger(size) || bodyEnd > bytes.length) {
      throw new Error(`Debian archive entry ${name} exceeds its bounds`);
    }
    entries.push({ name, bytes: bytes.subarray(bodyStart, bodyEnd) });
    offset = bodyEnd + (size % 2);
  }
  return entries;
}

function isText(name) {
  return (
    /\.(?:css|html|js|json|md|properties|toml|txt|xml|ya?ml)$/i.test(name) ||
    /(?:^|\/)\.env(?:\..*)?$/i.test(name)
  );
}

function scanBytes(name, bytes, inspectAssignments) {
  const violations = [];
  for (const marker of secretSentinels) {
    if (bytes.includes(Buffer.from(marker))) violations.push(`${name}: forbidden secret sentinel ${marker}`);
  }
  if (inspectAssignments && assignment.test(bytes.toString("utf8"))) {
    violations.push(`${name}: contains a secret-like assignment`);
  }
  return violations;
}

function isGzip(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function isPlainTarName(name) {
  return name.toLowerCase().endsWith(".tar");
}

function scanTar(name, bytes, depth = 0) {
  if (depth > 2) return [`${name}: nested archive depth exceeds the scan limit`];
  const violations = [];
  for (const entry of tarEntries(bytes)) {
    const entryName = `${name}:${entry.name}`;
    if (forbiddenNames.test(entry.name)) {
      violations.push(`${entryName}: forbidden archived filename`);
    }
    violations.push(...scanBytes(entryName, entry.bytes, isText(entry.name)));
    if (isGzip(entry.bytes)) {
      try {
        const expanded = gunzipSync(entry.bytes, {
          maxOutputLength: maximumExpandedArchiveBytes,
        });
        violations.push(...scanTar(entryName, expanded, depth + 1));
      } catch (error) {
        violations.push(
          `${entryName}: compressed TAR entry could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else if (isPlainTarName(entry.name)) {
      if (entry.bytes.length > maximumExpandedArchiveBytes) {
        violations.push(`${entryName}: plain TAR entry exceeds the expanded archive limit`);
        continue;
      }
      try {
        violations.push(...scanTar(entryName, entry.bytes, depth + 1));
      } catch (error) {
        violations.push(
          `${entryName}: plain TAR entry could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return violations;
}

function scanDeb(name, bytes) {
  const violations = [];
  for (const entry of arEntries(bytes)) {
    const entryName = `${name}:${entry.name}`;
    violations.push(...scanBytes(entryName, entry.bytes, isText(entry.name)));
    try {
      if (entry.name.endsWith(".tar.gz")) {
        violations.push(
          ...scanTar(
            entryName,
            gunzipSync(entry.bytes, { maxOutputLength: maximumExpandedArchiveBytes }),
          ),
        );
      } else if (entry.name.endsWith(".tar.zst")) {
        violations.push(
          ...scanTar(
            entryName,
            zstdDecompressSync(entry.bytes, {
              maxOutputLength: maximumExpandedArchiveBytes,
            }),
          ),
        );
      } else if (entry.name.startsWith("control.tar") || entry.name.startsWith("data.tar")) {
        violations.push(`${entryName}: unsupported Debian TAR compression`);
      }
    } catch (error) {
      violations.push(
        `${entryName}: Debian TAR entry could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return violations;
}

export function artifactViolations(root) {
  const violations = [];
  const files = payloadFiles(root);
  if (files.length === 0) return ["release artifact directory contains no payload artifacts"];
  for (const path of files) {
    const name = relative(root, path).replaceAll("\\", "/");
    if (forbiddenNames.test(name)) violations.push(`${name}: forbidden artifact filename`);
    const bytes = readFileSync(path);
    violations.push(...scanBytes(name, bytes, isText(name)));
    if (name.endsWith(".zip")) {
      try {
        for (const entry of zipEntries(bytes)) {
          if (forbiddenNames.test(entry.name)) violations.push(`${name}:${entry.name}: forbidden archived filename`);
          violations.push(...scanBytes(`${name}:${entry.name}`, entry.bytes, isText(entry.name)));
        }
      } catch (error) {
        violations.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (name.endsWith(".tar.gz")) {
      try {
        const expanded = gunzipSync(bytes, {
          maxOutputLength: maximumExpandedArchiveBytes,
        });
        violations.push(...scanTar(name, expanded));
      } catch (error) {
        violations.push(
          `${name}: compressed TAR could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (name.endsWith(".deb")) {
      try {
        violations.push(...scanDeb(name, bytes));
      } catch (error) {
        violations.push(
          `${name}: Debian package could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return violations;
}

export function checksumLines(root) {
  return payloadFiles(root).map((path) => {
    const name = relative(root, path).replaceAll("\\", "/");
    return `${digest(readFileSync(path))}  ${name}`;
  });
}

function cargoComponents(root) {
  const result = spawnSync("cargo", ["metadata", "--locked", "--format-version", "1"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`cargo metadata failed: ${result.stderr.trim() || result.error?.message || "unknown error"}`);
  }
  return productionCargoPackages(JSON.parse(result.stdout))
    .map((item) => ({
      type: "library",
      name: item.name,
      version: item.version,
      purl: `pkg:cargo/${encodeURIComponent(item.name)}@${item.version}`,
    }));
}

export function productionCargoPackages(metadata) {
  const nodes = new Map((metadata.resolve?.nodes ?? []).map((node) => [node.id, node]));
  const reachable = new Set(metadata.workspace_members ?? []);
  const pending = [...reachable];
  while (pending.length > 0) {
    const id = pending.pop();
    const node = nodes.get(id);
    for (const dependency of node?.deps ?? []) {
      const productionEdge = (dependency.dep_kinds ?? []).some(
        (kind) => kind.kind === null || kind.kind === "build",
      );
      if (productionEdge && !reachable.has(dependency.pkg)) {
        reachable.add(dependency.pkg);
        pending.push(dependency.pkg);
      }
    }
  }
  return (metadata.packages ?? []).filter(
    (item) => item.source !== null && reachable.has(item.id),
  );
}

function nodeComponents(root) {
  const result = spawnSync("pnpm", ["list", "--prod", "--recursive", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`pnpm production dependency inventory failed: ${result.stderr.trim() || result.error?.message || "unknown error"}`);
  }
  const components = [];
  const visit = (dependencies) => {
    for (const [name, item] of Object.entries(dependencies ?? {})) {
      if (typeof item.version === "string") {
        components.push({
          type: "library",
          name,
          version: item.version,
          purl: `pkg:npm/${encodeURIComponent(name)}@${item.version}`,
        });
      }
      visit(item.dependencies);
    }
  };
  for (const project of JSON.parse(result.stdout)) visit(project.dependencies);
  return components;
}

export function deduplicateComponents(components) {
  return [...new Map(components.map((item) => [`${item.purl}`, item])).values()].sort((left, right) => left.purl.localeCompare(right.purl));
}

function writeChecksums(root) {
  const lines = checksumLines(root);
  if (lines.length === 0) throw new Error("no artifacts are available for checksums");
  writeFileSync(resolve(root, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

export function buildReleaseManifest({ version, tag, commit, toolchains, artifacts, signing, validation, infrastructure }) {
  return {
    schemaVersion: 2,
    version,
    tag,
    commit,
    workflow: ".github/workflows/release.yml",
    toolchains,
    infrastructure,
    signing,
    validation,
    artifacts,
  };
}

export function artifactPlatform(name) {
  if (/native-host-windows|\.exe$/i.test(name)) return "windows-x86_64";
  if (/native-host-linux|\.AppImage$|\.deb$/i.test(name)) return "linux-x86_64";
  if (/nian-pass-browser-(?:chromium|firefox)-/i.test(name)) return "browser";
  if (/\.apk$/i.test(name)) return "android";
  if (/^gateway-image\.json$|nian-pass-sync-gateway-.*\.tar\.gz$/i.test(name)) return "gateway-linux-x86_64";
  if (name === "release-status.md") return "release-metadata";
  throw new Error(`could not classify release artifact platform for ${name}`);
}

function releaseToolchains() {
  const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
  const desktopPackage = JSON.parse(
    readFileSync(resolve(repositoryRoot, "apps/desktop/package.json"), "utf8"),
  );
  const rust = readFileSync(resolve(repositoryRoot, ".mise.toml"), "utf8").match(
    /^rust\s*=\s*"([^"]+)"/m,
  )?.[1];
  if (!rust) throw new Error("could not resolve pinned Rust version");
  return {
    rust,
    node: readFileSync(resolve(repositoryRoot, ".node-version"), "utf8").trim(),
    pnpm: rootPackage.packageManager.replace(/^pnpm@/, ""),
    tauriCli: desktopPackage.devDependencies["@tauri-apps/cli"],
    androidSdk: "36",
    androidBuildTools: "36.0.0",
    androidNdk: "28.2.13676358",
  };
}

function writeManifest(root) {
  const version = readFileSync(resolve(repositoryRoot, "VERSION"), "utf8").trim();
  const commitResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" });
  if (commitResult.status !== 0) throw new Error("could not resolve release commit");
  const artifacts = payloadFiles(root).map((path) => ({
    name: relative(root, path).replaceAll("\\", "/"),
    platform: artifactPlatform(relative(root, path).replaceAll("\\", "/")),
    sha256: digest(readFileSync(path)),
    size: statSync(path).size,
  }));
  const statusFile = process.env.RELEASE_STATUS_DATA_FILE;
  const validation = statusFile
    ? JSON.parse(readFileSync(resolve(statusFile), "utf8"))
    : {};
  const manifest = buildReleaseManifest({
    version,
    tag: process.env.RELEASE_TAG ?? null,
    commit: commitResult.stdout.trim(),
    toolchains: releaseToolchains(),
    signing: {
      windows: process.env.WINDOWS_SIGNING_STATUS ?? "NOT CONFIGURED",
      android: process.env.ANDROID_SIGNING_STATUS ?? "NOT CONFIGURED",
      other: process.env.OTHER_SIGNING_STATUS ?? "NOT CONFIGURED",
    },
    validation,
    infrastructure: {
      provider: "GitHub Actions hosted runners",
      workflowRunId: process.env.GITHUB_RUN_ID ?? null,
      runnerImages: process.env.RELEASE_RUNNER_IMAGES?.split(",").filter(Boolean) ?? [],
      reproducibilityBoundary: "Hosted runner VM images are external release infrastructure and are not digest-pinned.",
    },
    artifacts,
  });
  writeFileSync(resolve(root, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeSbom(root) {
  const components = deduplicateComponents([...cargoComponents(repositoryRoot), ...nodeComponents(repositoryRoot)]);
  writeFileSync(resolve(root, "sbom.cdx.json"), `${JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: { component: { type: "application", name: "nian-pass", version: readFileSync(resolve(repositoryRoot, "VERSION"), "utf8").trim() } },
    components,
  }, null, 2)}\n`);
}

function main() {
  const command = process.argv[2];
  const root = resolve(process.env.ARTIFACT_DIR ?? defaultArtifactRoot);
  mkdirSync(root, { recursive: true });
  if (command === "scan") {
    const violations = artifactViolations(root);
    if (violations.length > 0) throw new Error(violations.join("\n"));
    process.stdout.write("Release artifact secret and content scan passed.\n");
  } else if (command === "checksums") writeChecksums(root);
  else if (command === "manifest") writeManifest(root);
  else if (command === "sbom") writeSbom(root);
  else throw new Error("usage: release_artifacts.mjs scan|checksums|manifest|sbom");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try { main(); } catch (error) {
    process.stderr.write(`Release artifact operation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
