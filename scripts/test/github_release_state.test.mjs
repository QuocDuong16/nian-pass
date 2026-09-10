import assert from "node:assert/strict";
import { test } from "node:test";

import { publicationAction } from "../release_publication.mjs";
import { resolveGithubReleaseState } from "../github_release_state.mjs";

const tag = "v0.1.0-rc.7";
const commit = "85278c0cb90f28f61c4cf7035c7279acd88ac489";
const expected = { tag, commit, prerelease: true };

function release(overrides = {}) {
  return {
    id: 385985070,
    tag_name: tag,
    target_commitish: commit,
    draft: true,
    prerelease: true,
    ...overrides,
  };
}

test("empty and unrelated release lists resolve to none", () => {
  assert.deepEqual(resolveGithubReleaseState([], expected), {
    state: "none", prerelease: null, id: null, targetCommitish: null,
  });
  assert.equal(resolveGithubReleaseState([release({ tag_name: "v0.1.0-rc.6" })], expected).state, "none");
});

test("matching draft prerelease and final releases resolve as drafts", () => {
  assert.deepEqual(resolveGithubReleaseState([[release()]], expected), {
    state: "draft", prerelease: true, id: 385985070, targetCommitish: commit,
  });
  assert.equal(
    resolveGithubReleaseState([release({ tag_name: "v0.1.0", prerelease: false })], {
      tag: "v0.1.0", commit, prerelease: false,
    }).state,
    "draft",
  );
});

test("matching published release resolves as immutable published state", () => {
  assert.equal(resolveGithubReleaseState([release({ draft: false })], expected).state, "published");
});

test("RC7 draft fixture permits guarded publication with Forgejo PASS", () => {
  const state = resolveGithubReleaseState([release()], expected);
  assert.equal(publicationAction({
    releaseState: state.state,
    existingPrerelease: state.prerelease,
    releaseKind: "prerelease",
    publishRequested: true,
    forgejoCiStatus: "PASS",
    eventName: "workflow_dispatch",
    releaseTag: tag,
  }), "UPDATE_AND_PUBLISH");
});

for (const [name, releases, expectedError] of [
  ["wrong target commit", [release({ target_commitish: "f".repeat(40) })], /not expected commit/],
  ["wrong prerelease", [release({ prerelease: false })], /not expected true/],
  ["malformed release", [{ tag_name: tag }], /target_commitish must be a non-empty string/],
  ["ambiguous exact tags", [release(), release({ id: 385985071 })], /2 matching releases/],
]) {
  test(`${name} fails closed`, () => {
    assert.throws(() => resolveGithubReleaseState(releases, expected), expectedError);
  });
}
