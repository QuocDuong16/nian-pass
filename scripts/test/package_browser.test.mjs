import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { deterministicZip } from "../../apps/browser-extension/build/package.mjs";
import { buildNativeHostArchive } from "../package_native_host.mjs";

function centralDirectoryEntries(bytes) {
  const endOffset = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(endOffset), 0x06054b50);
  const count = bytes.readUInt16LE(endOffset + 10);
  let offset = bytes.readUInt32LE(endOffset + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const nameSize = bytes.readUInt16LE(offset + 28);
    const extraSize = bytes.readUInt16LE(offset + 30);
    const commentSize = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString("utf8");
    entries.set(name, {
      creatorSystem: bytes.readUInt16LE(offset + 4) >>> 8,
      unixMode: bytes.readUInt32LE(offset + 38) >>> 16,
    });
    offset += 46 + nameSize + extraSize + commentSize;
  }
  return entries;
}

test("browser ZIP bytes are deterministic", () => {
  const entries = [
    { name: "a.txt", bytes: Buffer.from("alpha") },
    { name: "nested/b.txt", bytes: Buffer.from("beta") },
  ];
  const first = deterministicZip(entries);
  const second = deterministicZip(entries);
  assert.deepEqual(first, second);
  assert.equal(first.readUInt32LE(0), 0x04034b50);
  assert.equal(first.readUInt32LE(first.length - 22), 0x06054b50);
});

test("browser ZIP entries default to regular files with mode 0644", () => {
  const archive = deterministicZip([
    { name: "manifest.json", bytes: Buffer.from("{}") },
    { name: "nested/app.js", bytes: Buffer.from("export {}") },
  ]);
  for (const metadata of centralDirectoryEntries(archive).values()) {
    assert.equal(metadata.creatorSystem, 3);
    assert.equal(metadata.unixMode & 0o170000, 0o100000);
    assert.equal(metadata.unixMode & 0o777, 0o644);
  }
});

test("Linux native host ZIP preserves only the requested executable mode", () => {
  const archive = buildNativeHostArchive("linux-x86_64", Buffer.from("synthetic host"), "0.1.0-rc.2");
  const entries = centralDirectoryEntries(archive);
  assert.deepEqual([...entries.keys()], ["nian-pass-browser-host", "INSTALL.txt"]);
  assert.equal(entries.get("nian-pass-browser-host").unixMode & 0o170000, 0o100000);
  assert.equal(entries.get("nian-pass-browser-host").unixMode & 0o777, 0o755);
  assert.equal(entries.get("INSTALL.txt").unixMode & 0o170000, 0o100000);
  assert.equal(entries.get("INSTALL.txt").unixMode & 0o777, 0o644);
  assert.deepEqual(archive, buildNativeHostArchive("linux-x86_64", Buffer.from("synthetic host"), "0.1.0-rc.2"));
});

test("Windows native host ZIP keeps conservative Unix mode metadata", () => {
  const archive = buildNativeHostArchive("windows-x86_64", Buffer.from("synthetic host"), "0.1.0-rc.2");
  const metadata = centralDirectoryEntries(archive).get("nian-pass-browser-host.exe");
  assert.equal(metadata.unixMode & 0o170000, 0o100000);
  assert.equal(metadata.unixMode & 0o777, 0o644);
});

test(
  "standard unzip restores the Linux native host executable bit",
  {
    skip: spawnSync("unzip", ["-v"], { stdio: "ignore" }).status !== 0,
  },
  (t) => {
    const root = mkdtempSync(join(tmpdir(), "nian-pass-native-host-zip-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const archivePath = join(root, "host.zip");
    const output = join(root, "output");
    writeFileSync(archivePath, buildNativeHostArchive("linux-x86_64", Buffer.from("synthetic host"), "0.1.0-rc.2"));
    execFileSync("unzip", ["-qq", archivePath, "-d", output]);
    assert.notEqual(statSync(join(output, "nian-pass-browser-host")).mode & 0o111, 0);
    assert.equal(statSync(join(output, "INSTALL.txt")).mode & 0o111, 0);
  },
);
