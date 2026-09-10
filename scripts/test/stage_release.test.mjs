import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { stageReleaseArtifacts } from "../stage_release.mjs";
import { canonicalReleaseAssetName } from "../release_asset_name.mjs";

function directory(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-stage-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("staging canonicalizes the RC8 space-containing native asset names", (t) => {
  const root = directory(t);
  const bundles = join(root, "bundles");
  const output = join(root, "release");
  mkdirSync(bundles);
  const source = {
    "Nian Pass_0.1.0-rc.9_amd64.AppImage": "appimage",
    "Nian Pass_0.1.0-rc.9_amd64.deb": "deb",
    "Nian Pass_0.1.0-rc.9_x64-setup.exe": "setup",
    "app-universal-release-unsigned.apk": "apk",
    "nian-pass-browser-chromium-0.1.0-rc.9.zip": "browser",
  };
  for (const [name, bytes] of Object.entries(source)) writeFileSync(join(bundles, name), bytes);
  mkdirSync(output);
  writeFileSync(join(output, "Nian Pass_0.1.0-rc.9_amd64.deb"), "stale legacy name");

  const staged = stageReleaseArtifacts([bundles], output);
  assert.deepEqual(staged, [
    "app-universal-release-unsigned.apk",
    "Nian.Pass_0.1.0-rc.9_amd64.AppImage",
    "Nian.Pass_0.1.0-rc.9_amd64.deb",
    "Nian.Pass_0.1.0-rc.9_x64-setup.exe",
  ].sort((left, right) => left.localeCompare(right)));
  for (const [name, bytes] of Object.entries(source).filter(([name]) => !name.endsWith(".zip"))) {
    const canonical = name.replaceAll(" ", ".");
    assert.equal(readFileSync(join(output, canonical), "utf8"), bytes);
  }
  assert.equal(
    canonicalReleaseAssetName("nian-pass-browser-chromium-0.1.0-rc.9.zip"),
    "nian-pass-browser-chromium-0.1.0-rc.9.zip",
  );
  assert.throws(() => readFileSync(join(output, "Nian Pass_0.1.0-rc.9_amd64.deb")));
});

test("staging fails closed when canonical names collide", (t) => {
  const root = directory(t);
  const bundles = join(root, "bundles");
  mkdirSync(bundles);
  writeFileSync(join(bundles, "Nian Pass_test.exe"), "left");
  writeFileSync(join(bundles, "Nian.Pass_test.exe"), "right");
  assert.throws(
    () => stageReleaseArtifacts([bundles], join(root, "release")),
    /canonical release asset filename collision Nian\.Pass_test\.exe: .*Nian Pass_test\.exe.*Nian\.Pass_test\.exe/,
  );
});
