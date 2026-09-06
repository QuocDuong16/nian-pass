import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import {
  artifactViolations,
  buildReleaseManifest,
  checksumLines,
  deduplicateComponents,
  productionCargoPackages,
} from "../release_artifacts.mjs";

function directory(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-artifacts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function tarArchive(name, body) {
  const bytes = Buffer.from(body);
  const paddedSize = Math.ceil(bytes.length / 512) * 512;
  const archive = Buffer.alloc(512 + paddedSize + 1024);
  archive.write(name, 0, 100, "utf8");
  archive.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  archive[156] = "0".charCodeAt(0);
  bytes.copy(archive, 512);
  return archive;
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

test("checksums cover payload bytes and exclude generated metadata", (t) => {
  const root = directory(t);
  writeFileSync(join(root, "app.bin"), "release bytes");
  writeFileSync(join(root, "SHA256SUMS"), "stale");
  const lines = checksumLines(root);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^[0-9a-f]{64}  app\.bin$/);
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
  writeFileSync(
    join(root, "gateway.tar.gz"),
    gzipSync(tarArchive("image/.env.production", "TOKEN=M8_RELEASE_SECRET")),
  );
  const violations = artifactViolations(root).join("\n");
  assert.match(violations, /forbidden archived filename/);
  assert.match(violations, /secret sentinel/);
  assert.match(violations, /secret-like assignment/);
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
  assert.deepEqual(deduplicateComponents([
    { purl: "pkg:npm/z@1", name: "z" },
    { purl: "pkg:cargo/a@1", name: "a" },
    { purl: "pkg:npm/z@1", name: "z" },
  ]).map((item) => item.name), ["a", "z"]);
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
    version: "0.1.0",
    tag: "v0.1.0",
    commit: "a".repeat(40),
    toolchains: { rust: "1.98.0", node: "26.7.0" },
    signing: { windows: "NOT RUN" },
    artifacts: [{ name: "app.bin", sha256: "b".repeat(64), size: 12 }],
  });
  assert.equal(manifest.workflow, ".forgejo/workflows/release.yml");
  assert.equal(manifest.toolchains.rust, "1.98.0");
  assert.equal(manifest.artifacts[0].sha256, "b".repeat(64));
  assert.equal(manifest.signing.windows, "NOT RUN");
});
