import assert from "node:assert/strict";
import { test } from "node:test";

import { validateGithubReleaseIdentity } from "../github_release_identity.mjs";

const expected = {
  id: 123,
  tag: "v0.1.0",
  commit: "0123456789abcdef0123456789abcdef01234567",
  prerelease: false,
};

function release(overrides = {}) {
  return {
    id: expected.id,
    tag_name: expected.tag,
    target_commitish: expected.commit,
    draft: true,
    prerelease: expected.prerelease,
    ...overrides,
  };
}

test("release-by-ID resolver accepts an exact draft identity", () => {
  assert.deepEqual(validateGithubReleaseIdentity(release(), { ...expected, draft: true }), {
    draft: true,
    prerelease: false,
    id: 123,
    tag: "v0.1.0",
    targetCommitish: expected.commit,
  });
});

test("release-by-ID resolver accepts an exact published identity", () => {
  assert.equal(
    validateGithubReleaseIdentity(release({ draft: false, published_at: "2026-09-10T00:00:00Z" }), {
      ...expected,
      draft: false,
      requirePublishedAt: true,
    }).draft,
    false,
  );
});

test("RC9 synthetic untagged release is rejected even when published", () => {
  assert.throws(
    () => validateGithubReleaseIdentity({
      id: 386063656,
      tag_name: "untagged-dc8ca8cbcb9598874f8d",
      target_commitish: "d4368656baa768405f2157537749ca89ad5c981a",
      draft: false,
      prerelease: true,
    }, {
      id: 386063656,
      tag: "v0.1.0-rc.9",
      commit: "d4368656baa768405f2157537749ca89ad5c981a",
      prerelease: true,
      draft: false,
      requirePublishedAt: false,
    }),
    /release tag identity drift: expected v0\.1\.0-rc\.9, observed untagged-/,
  );
});

for (const [name, overrides, pattern] of [
  ["ID drift", { id: 124 }, /release ID identity drift/],
  ["tag drift", { tag_name: "untagged-deadbeef" }, /release tag identity drift/],
  ["commit drift", { target_commitish: "different" }, /release commit identity drift/],
  ["prerelease drift", { prerelease: true }, /release prerelease identity drift/],
  ["notes unexpectedly publishes", { draft: false }, /release draft state drift/],
]) {
  test(`notes PATCH response rejects ${name}`, () => {
    assert.throws(() => validateGithubReleaseIdentity(release(overrides), { ...expected, draft: true }), pattern);
  });
}

test("publish PATCH response rejects a still-draft response", () => {
  assert.throws(
    () => validateGithubReleaseIdentity(release(), { ...expected, draft: false, requirePublishedAt: true }),
    /release draft state drift/,
  );
});

test("publish PATCH response requires published_at", () => {
  assert.throws(
    () => validateGithubReleaseIdentity(release({ draft: false }), {
      ...expected,
      draft: false,
      requirePublishedAt: true,
    }),
    /published_at/,
  );
});

for (const [name, overrides, pattern] of [
  ["ID drift", { id: 124 }, /release ID identity drift/],
  ["tag drift", { tag_name: "untagged-deadbeef" }, /release tag identity drift/],
  ["commit drift", { target_commitish: "different" }, /release commit identity drift/],
  ["prerelease drift", { prerelease: true }, /release prerelease identity drift/],
]) {
  test(`publish PATCH response rejects ${name}`, () => {
    assert.throws(
      () => validateGithubReleaseIdentity(release({ draft: false, published_at: "2026-09-10T00:00:00Z", ...overrides }), {
        ...expected,
        draft: false,
        requirePublishedAt: true,
      }),
      pattern,
    );
  });
}

test("malformed release-by-ID responses fail closed", () => {
  assert.throws(
    () => validateGithubReleaseIdentity({ ...release(), draft: "true" }, { ...expected, draft: true }),
    /release\.draft must be a boolean/,
  );
});
