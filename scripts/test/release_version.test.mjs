import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isPrereleaseVersion,
  isReleaseVersion,
  releaseVersionKind,
} from "../release_version.mjs";

test("release versions classify generic prerelease suffixes", () => {
  for (const version of [
    "0.1.0-rc.1",
    "0.1.0-rc.2",
    "0.1.0-rc.3",
    "0.1.0-rc.4",
    "0.1.0-rc.5",
    "0.1.0-rc.6",
    "0.1.0-rc.9",
    "0.1.0-beta.1",
  ]) {
    assert.equal(isReleaseVersion(version), true);
    assert.equal(releaseVersionKind(version), "prerelease");
    assert.equal(isPrereleaseVersion(version), true);
  }
});

test("release versions without a suffix classify as final", () => {
  for (const version of ["0.1.0", "1.2.3"]) {
    assert.equal(isReleaseVersion(version), true);
    assert.equal(releaseVersionKind(version), "final");
    assert.equal(isPrereleaseVersion(version), false);
  }
});

test("invalid release versions fail closed", () => {
  for (const version of ["", "v0.1.0", "0.1", "0.1.0-", "0.1.0-rc."]) {
    assert.equal(isReleaseVersion(version), false);
    assert.throws(() => releaseVersionKind(version), /invalid release version/);
  }
});
