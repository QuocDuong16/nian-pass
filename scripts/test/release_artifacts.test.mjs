import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import {
  artifactViolations,
  artifactPlatform,
  buildReleaseManifest,
  checksumLines,
  deduplicateComponents,
  finalizePublicationStatus,
  productionCargoPackages,
  writeSbom,
} from "../release_artifacts.mjs";
import { assembleReleaseSet } from "../assemble_release.mjs";
import { releaseStatuses, releaseStatusMarkdown } from "../release_status.mjs";
import { deterministicZip } from "../../apps/browser-extension/build/package.mjs";

function directory(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-artifacts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function tarArchive(nameOrEntries, body) {
  const entries = typeof nameOrEntries === "string" ? [{ name: nameOrEntries, body }] : nameOrEntries;
  const parts = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.body);
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write("00000000000\0", 136, 12, "ascii");
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    parts.push(header, bytes, Buffer.alloc(Math.ceil(bytes.length / 512) * 512 - bytes.length));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

function arArchive(name, body) {
  const bytes = Buffer.from(body);
  const header = Buffer.alloc(60, " ");
  header.write(`${name}/`, 0, 16, "utf8");
  header.write(String(bytes.length), 48, 10, "ascii");
  header.write("`\n", 58, 2, "ascii");
  return Buffer.concat([
    Buffer.from("!<arch>\n", "ascii"),
    header,
    bytes,
    bytes.length % 2 === 0 ? Buffer.alloc(0) : Buffer.from("\n"),
  ]);
}

test("checksums cover final published metadata and exclude only themselves", (t) => {
  const root = directory(t);
  writeFileSync(join(root, "app.bin"), "release bytes");
  writeFileSync(join(root, "release-status.md"), "DRAFT\n");
  writeFileSync(join(root, "sbom.cdx.json"), "{}\n");
  writeFileSync(join(root, "release-manifest.json"), "{}\n");
  writeFileSync(join(root, "SHA256SUMS"), "stale");
  const lines = checksumLines(root);
  assert.equal(lines.length, 4);
  assert.match(lines.join("\n"), /^[0-9a-f]{64}  app\.bin$/m);
  assert.match(lines.join("\n"), /^[0-9a-f]{64}  release-manifest\.json$/m);
  assert.match(lines.join("\n"), /^[0-9a-f]{64}  release-status\.md$/m);
  assert.match(lines.join("\n"), /^[0-9a-f]{64}  sbom\.cdx\.json$/m);
  assert.doesNotMatch(lines.join("\n"), /  SHA256SUMS$/m);
});

test("basename-only checksums require the canonical release directory as cwd", (t) => {
  const root = directory(t);
  const release = join(root, "release");
  mkdirSync(release);
  writeFileSync(join(release, "payload.bin"), "release bytes");
  writeFileSync(join(release, "SHA256SUMS"), `${checksumLines(release).join("\n")}\n`);

  const fromRelease = spawnSync("sha256sum", ["--check", "SHA256SUMS"], {
    cwd: release,
    encoding: "utf8",
  });
  assert.equal(fromRelease.status, 0, fromRelease.stderr);

  const fromParent = spawnSync("sha256sum", ["--check", "release/SHA256SUMS"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(fromParent.status, 0, "repository-root verification must not resolve release basenames");
});

test("artifact scan rejects secret sentinels and forbidden retained files", (t) => {
  const root = directory(t);
  writeFileSync(join(root, "app.bin"), "M8_RELEASE_SECRET");
  writeFileSync(join(root, "debug.map"), "{}\n");
  const violations = artifactViolations(root).join("\n");
  assert.match(violations, /secret sentinel/);
  assert.match(violations, /forbidden artifact filename/);
});

test("artifact scan passes an ordinary binary", (t) => {
  const root = directory(t);
  writeFileSync(join(root, "app.bin"), Buffer.from([0, 1, 2, 3]));
  assert.deepEqual(artifactViolations(root), []);
});

test("artifact scan inspects compressed container TAR contents", (t) => {
  const root = directory(t);
  writeFileSync(join(root, "gateway.tar.gz"), gzipSync(tarArchive("image/.env.production", "TOKEN=M8_RELEASE_SECRET")));
  const violations = artifactViolations(root).join("\n");
  assert.match(violations, /forbidden archived filename/);
  assert.match(violations, /secret sentinel/);
  assert.match(violations, /secret-like assignment/);
});

test("artifact scan rejects forbidden filenames inside Docker plain layer TARs", (t) => {
  const root = directory(t);
  const layer = tarArchive("app/.env.production", "benign fixture contents");
  const dockerArchive = tarArchive([
    { name: "manifest.json", body: "[]" },
    { name: "config.json", body: "{}" },
    { name: "abc123/layer.tar", body: layer },
  ]);
  writeFileSync(join(root, "nian-pass-sync-gateway-0.1.0.tar.gz"), gzipSync(dockerArchive));
  const violations = artifactViolations(root).join("\n");
  assert.match(violations, /abc123\/layer\.tar:app\/\.env\.production: forbidden archived filename/);
});

test("artifact scan accepts ordinary files inside Docker plain layer TARs", (t) => {
  const root = directory(t);
  const layer = tarArchive("usr/local/bin/nian-pass-sync-gateway", Buffer.from([0, 1, 2, 3]));
  const dockerArchive = tarArchive([
    { name: "manifest.json", body: "[]" },
    { name: "config.json", body: "{}" },
    { name: "abc123/layer.tar", body: layer },
  ]);
  writeFileSync(join(root, "nian-pass-sync-gateway-0.1.0.tar.gz"), gzipSync(dockerArchive));
  assert.deepEqual(artifactViolations(root), []);
});

test("artifact scan inspects Debian data archives", (t) => {
  const root = directory(t);
  const data = gzipSync(tarArchive("usr/share/nian-pass/debug.map", "M8_RELEASE_SECRET"));
  writeFileSync(join(root, "nian-pass.deb"), arArchive("data.tar.gz", data));
  const violations = artifactViolations(root).join("\n");
  assert.match(violations, /forbidden archived filename/);
  assert.match(violations, /secret sentinel/);
});

test("SBOM components are unique and sorted", () => {
  assert.deepEqual(
    deduplicateComponents([
      { purl: "pkg:npm/z@1", name: "z" },
      { purl: "pkg:cargo/a@1", name: "a" },
      { purl: "pkg:npm/z@1", name: "z" },
    ]).map((item) => item.name),
    ["a", "z"],
  );
});

test("Rust SBOM excludes dependencies reachable only through dev edges", () => {
  const registry = "registry+https://github.com/rust-lang/crates.io-index";
  const metadata = {
    workspace_members: ["app"],
    packages: [
      { id: "app", source: null },
      { id: "runtime", source: registry },
      { id: "test-only", source: registry },
    ],
    resolve: {
      nodes: [
        {
          id: "app",
          deps: [
            { pkg: "runtime", dep_kinds: [{ kind: null }] },
            { pkg: "test-only", dep_kinds: [{ kind: "dev" }] },
          ],
        },
        { id: "runtime", deps: [] },
        { id: "test-only", deps: [] },
      ],
    },
  };
  assert.deepEqual(
    productionCargoPackages(metadata).map((item) => item.id),
    ["runtime"],
  );
});

test("release manifest binds artifacts to source, toolchains, and signing", () => {
  const manifest = buildReleaseManifest({
    version: "0.1.0-rc.3",
    tag: "v0.1.0-rc.3",
    commit: "a".repeat(40),
    toolchains: { rust: "1.98.0", node: "26.7.0" },
    signing: { windows: "NOT RUN" },
    validation: { "Windows full GUI runtime": "NOT RUN" },
    infrastructure: { provider: "GitHub Actions hosted runners" },
    artifacts: [{ name: "app.bin", sha256: "b".repeat(64), size: 12 }],
  });
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.releaseKind, "prerelease");
  assert.equal(manifest.workflow, ".github/workflows/release.yml");
  assert.equal(manifest.toolchains.rust, "1.98.0");
  assert.equal(manifest.artifacts[0].sha256, "b".repeat(64));
  assert.equal(manifest.signing.windows, "NOT RUN");
  assert.equal(manifest.validation["Windows full GUI runtime"], "NOT RUN");
  assert.match(manifest.infrastructure.provider, /GitHub Actions/);
});

test("release payload names map to explicit manifest platforms", () => {
  assert.equal(artifactPlatform("Nian Pass_0.1.0_x64-setup.exe"), "windows-x86_64");
  assert.equal(artifactPlatform("Nian_Pass_0.1.0_amd64.AppImage"), "linux-x86_64");
  assert.equal(artifactPlatform("nian-pass-browser-firefox-0.1.0.zip"), "browser");
  assert.equal(artifactPlatform("app-universal-release.apk"), "android");
  assert.equal(artifactPlatform("nian-pass-sync-gateway-0.1.0.tar.gz"), "gateway-linux-x86_64");
  assert.throws(() => artifactPlatform("unknown.bin"), /could not classify/);
});

test("platform payloads assemble into one exact canonical release set", (t) => {
  const root = directory(t);
  const input = join(root, "platforms");
  const output = join(root, "release");
  const payloads = {
    windows: ["Nian Pass_0.1.0-rc.3_x64-setup.exe", "nian-pass-native-host-windows-x86_64-0.1.0-rc.3.zip"],
    linux: ["Nian_Pass_0.1.0-rc.3_amd64.AppImage", "Nian Pass_0.1.0-rc.3_amd64.deb", "nian-pass-native-host-linux-x86_64-0.1.0-rc.3.zip"],
    browser: ["nian-pass-browser-chromium-0.1.0-rc.3.zip", "nian-pass-browser-firefox-0.1.0-rc.3.zip"],
    android: ["app-universal-release-unsigned.apk"],
    gateway: ["gateway-image.json", "nian-pass-sync-gateway-0.1.0-rc.3.tar.gz"],
  };
  for (const [platform, names] of Object.entries(payloads)) {
    mkdirSync(join(input, platform), { recursive: true });
    for (const name of names) writeFileSync(join(input, platform, name), `${platform}:${name}`);
  }
  const staged = assembleReleaseSet(input, output, "0.1.0-rc.3");
  assert.deepEqual(staged.sort(), Object.values(payloads).flat().sort());
  assert.deepEqual(readdirSync(output).sort(), staged.sort());
  assert.equal(readFileSync(join(output, "gateway-image.json"), "utf8"), "gateway:gateway-image.json");
});

test("canonical aggregation runs scan, SBOM, manifest, and final checksums", (t) => {
  const root = directory(t);
  const input = join(root, "platforms");
  const output = join(root, "release");
  const safeZip = deterministicZip([{ name: "README.txt", bytes: Buffer.from("release payload\n") }]);
  const safeDeb = arArchive("data.tar.gz", gzipSync(tarArchive("usr/bin/nian-pass", "binary")));
  const payloads = {
    windows: {
      "Nian Pass_0.1.0-rc.3_x64-setup.exe": Buffer.from([0, 1, 2, 3]),
      "nian-pass-native-host-windows-x86_64-0.1.0-rc.3.zip": safeZip,
    },
    linux: {
      "Nian_Pass_0.1.0-rc.3_amd64.AppImage": Buffer.from([0, 1, 2, 3]),
      "Nian Pass_0.1.0-rc.3_amd64.deb": safeDeb,
      "nian-pass-native-host-linux-x86_64-0.1.0-rc.3.zip": safeZip,
    },
    browser: {
      "nian-pass-browser-chromium-0.1.0-rc.3.zip": safeZip,
      "nian-pass-browser-firefox-0.1.0-rc.3.zip": safeZip,
    },
    android: { "app-universal-release-unsigned.apk": Buffer.from([0, 1, 2, 3]) },
    gateway: {
      "gateway-image.json": Buffer.from('{"imageId":"sha256:fixture"}\n'),
      "nian-pass-sync-gateway-0.1.0-rc.3.tar.gz": gzipSync(tarArchive("usr/local/bin/nian-pass-sync-gateway", "binary")),
    },
  };
  for (const [platform, files] of Object.entries(payloads)) {
    mkdirSync(join(input, platform), { recursive: true });
    for (const [name, bytes] of Object.entries(files)) writeFileSync(join(input, platform, name), bytes);
  }
  assembleReleaseSet(input, output, "0.1.0-rc.3");
  writeFileSync(join(output, "release-status.md"), "# Release status\n\nExperimental release.\n");
  const statusData = join(root, "release-status.json");
  writeFileSync(statusData, '{"Windows full GUI runtime":"NOT RUN"}\n');
  const runArtifactCommand = (command) => {
    const result = spawnSync(process.execPath, [join(import.meta.dirname, "..", "release_artifacts.mjs"), command], {
      cwd: join(import.meta.dirname, "../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        ARTIFACT_DIR: output,
        RELEASE_TAG: "v0.1.0-rc.3",
        RELEASE_STATUS_DATA_FILE: statusData,
      },
    });
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  };

  runArtifactCommand("scan");
  writeSbom(output, [
    {
      type: "library",
      name: "fixture-runtime",
      version: "1.0.0",
      purl: "pkg:npm/fixture-runtime@1.0.0",
    },
  ]);
  runArtifactCommand("manifest");
  runArtifactCommand("checksums");

  const manifest = JSON.parse(readFileSync(join(output, "release-manifest.json"), "utf8"));
  assert.equal(manifest.artifacts.length, 12);
  assert.equal(manifest.version, "0.1.0-rc.3");
  assert.equal(manifest.releaseKind, "prerelease");
  assert.equal(manifest.tag, "v0.1.0-rc.3");
  assert.equal(manifest.validation["Windows full GUI runtime"], "NOT RUN");
  assert.ok(
    manifest.artifacts.some((artifact) => artifact.name === "release-status.md"),
  );
  assert.ok(
    manifest.artifacts.some((artifact) => artifact.name === "sbom.cdx.json"),
  );
  assert.ok(
    !manifest.artifacts.some(
      (artifact) => artifact.name === "release-manifest.json",
    ),
  );
  assert.ok(
    !manifest.artifacts.some((artifact) => artifact.name === "SHA256SUMS"),
  );
  const sbom = JSON.parse(readFileSync(join(output, "sbom.cdx.json"), "utf8"));
  assert.equal(sbom.metadata.component.version, "0.1.0-rc.3");
  assert.deepEqual(sbom.components.map((component) => component.name), ["fixture-runtime"]);
  const verifyChecksums = () =>
    spawnSync("sha256sum", ["--check", "SHA256SUMS"], {
      cwd: output,
      encoding: "utf8",
    });
  const sums = readFileSync(join(output, "SHA256SUMS"), "utf8");
  assert.match(sums, /^[0-9a-f]{64}  Nian_Pass_0\.1\.0-rc\.3_amd64\.AppImage$/m);
  assert.match(sums, /^[0-9a-f]{64}  gateway-image\.json$/m);
  assert.match(sums, /^[0-9a-f]{64}  release-manifest\.json$/m);
  assert.match(sums, /^[0-9a-f]{64}  release-status\.md$/m);
  assert.match(sums, /^[0-9a-f]{64}  sbom\.cdx\.json$/m);
  assert.doesNotMatch(sums, /  SHA256SUMS$/m);
  let checksumResult = verifyChecksums();
  assert.equal(checksumResult.status, 0, checksumResult.stderr);

  const originalSbom = readFileSync(join(output, "sbom.cdx.json"));
  writeFileSync(
    join(output, "sbom.cdx.json"),
    Buffer.concat([originalSbom, Buffer.from("tampered\n")]),
  );
  checksumResult = verifyChecksums();
  assert.notEqual(
    checksumResult.status,
    0,
    "post-generation SBOM tampering must fail",
  );
  writeFileSync(join(output, "sbom.cdx.json"), originalSbom);
  runArtifactCommand("checksums");

  const originalManifest = readFileSync(join(output, "release-manifest.json"));
  writeFileSync(
    join(output, "release-manifest.json"),
    Buffer.concat([originalManifest, Buffer.from("tampered\n")]),
  );
  checksumResult = verifyChecksums();
  assert.notEqual(
    checksumResult.status,
    0,
    "post-generation release-manifest tampering must fail",
  );
  writeFileSync(join(output, "release-manifest.json"), originalManifest);
  runArtifactCommand("checksums");

  finalizePublicationStatus(output, "PASS");
  const finalized = JSON.parse(
    readFileSync(join(output, "release-manifest.json"), "utf8"),
  );
  assert.equal(finalized.validation["GitHub Release publication"], "PASS");
  assert.match(
    readFileSync(join(output, "release-status.md"), "utf8"),
    /GitHub Release publication\s+PASS/,
  );
  checksumResult = verifyChecksums();
  assert.equal(checksumResult.status, 0, checksumResult.stderr);
});

test("release assembly rejects unexpected platform payloads", (t) => {
  const root = directory(t);
  for (const platform of ["windows", "linux", "browser", "android", "gateway"]) {
    mkdirSync(join(root, platform), { recursive: true });
  }
  writeFileSync(join(root, "windows", ".env.production"), "benign");
  assert.throws(() => assembleReleaseSet(root, join(root, "out"), "0.1.0"), /unexpected release payload/);
});

test("release status keeps runtime and signing evidence distinct", () => {
  const statuses = releaseStatuses({
    WINDOWS_BUILD_STATUS: "PASS",
    WINDOWS_GUI_STATUS: "NOT RUN",
    WINDOWS_SIGNING_STATUS: "NOT CONFIGURED",
  });
  const report = releaseStatusMarkdown({
    version: "0.1.0",
    tag: "v0.1.0",
    commit: "a".repeat(40),
    statuses,
  });
  assert.match(report, /Windows release build\s+PASS/);
  assert.match(report, /Windows full GUI runtime\s+NOT RUN/);
  assert.match(report, /Windows Authenticode\s+NOT CONFIGURED/);
  assert.match(report, /Apple: M9\+ DEFERRED/);
  assert.match(report, /Known limitations:/);
  assert.match(report, /Release class: final/);
});

test("RC release status is explicitly classified as a prerelease", () => {
  const report = releaseStatusMarkdown({
    version: "0.1.0-rc.3",
    tag: "v0.1.0-rc.3",
    commit: "a".repeat(40),
    statuses: releaseStatuses({}),
  });
  assert.match(report, /^# Nian Pass 0\.1\.0-rc\.3 release validation/m);
  assert.match(report, /Release class: prerelease/);
});
