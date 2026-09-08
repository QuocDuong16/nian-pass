import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { pinnedRustVersion } from "../release_toolchain.mjs";

test("Windows release Rust pin parser accepts LF, CRLF, and trailing horizontal whitespace", () => {
  for (const mise of [
    '[tools]\nrust = "1.98.0"\n',
    '[tools]\r\nrust = "1.98.0"\r\n',
    '[tools]\r\nrust = "1.98.0"   \r\n',
  ]) {
    assert.equal(pinnedRustVersion(mise), "1.98.0");
  }
});

test("Windows release Rust pin parser fails closed on malformed configuration", () => {
  for (const mise of [
    "[tools]\nnode = \"26.7.0\"\n",
    '[tools]\nrust = ""\n',
    '[tools]\nrust = "1.98.0\n',
  ]) {
    assert.throws(() => pinnedRustVersion(mise), /Could not read the pinned Rust version/);
  }
});

test("Windows release script invokes the tested TOML toolchain helper", (t) => {
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  const script = readFileSync(join(repositoryRoot, "scripts/release_windows.ps1"), "utf8");
  assert.match(script, /node\s+"scripts\/release_toolchain\.mjs"\s+"\.mise\.toml"/);

  const root = mkdtempSync(join(tmpdir(), "nian-pass-release-toolchain-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const misePath = join(root, ".mise.toml");
  writeFileSync(misePath, '[tools]\r\nrust = "1.98.0"\r\n');
  const result = spawnSync(process.execPath, [
    join(repositoryRoot, "scripts/release_toolchain.mjs"),
    misePath,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "1.98.0\n");
});
