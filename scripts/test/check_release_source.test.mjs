import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  dirtyTreeViolation,
  githubReleaseWorkflowViolations,
  isExactVersion,
  tagIdentityViolation,
  tagViolation,
} from "../check_release_source.mjs";

const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid"];

function git(root, ...arguments_) {
  return execFileSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-release-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "VERSION"), "0.1.0\n");
  git(root, "init", "--quiet");
  git(root, "add", "VERSION");
  git(root, ...identity, "commit", "--quiet", "-m", "fixture");
  return root;
}

function commitChange(root, name = "change.txt") {
  writeFileSync(join(root, name), `${name}\n`);
  git(root, "add", name);
  git(root, ...identity, "commit", "--quiet", "-m", name);
}

test("tag must match the authoritative VERSION", (t) => {
  const root = repository(t);
  assert.equal(tagViolation(root, "v0.1.0"), null);
  assert.match(tagViolation(root, "v0.1.1"), /!= v0\.1\.0/);
});

test("lightweight release tag pointing to HEAD is accepted", (t) => {
  const root = repository(t);
  git(root, "tag", "v0.1.0");
  assert.equal(tagIdentityViolation(root, "v0.1.0"), null);
});

test("release tag pointing to the previous commit rejects the current HEAD", (t) => {
  const root = repository(t);
  git(root, "tag", "v0.1.0");
  commitChange(root);
  assert.match(tagIdentityViolation(root, "v0.1.0"), /not HEAD/);
});

test("a branch named like the release does not satisfy the tag gate", (t) => {
  const root = repository(t);
  git(root, "branch", "v0.1.0");
  assert.match(tagIdentityViolation(root, "v0.1.0"), /does not exist/);
});

test("a tag explicitly targeting another commit is rejected", (t) => {
  const root = repository(t);
  const firstCommit = git(root, "rev-parse", "HEAD");
  commitChange(root);
  git(root, "tag", "v0.1.0", firstCommit);
  assert.match(tagIdentityViolation(root, "v0.1.0"), /not HEAD/);
});

test("annotated release tag peels to and accepts HEAD", (t) => {
  const root = repository(t);
  git(root, ...identity, "tag", "-a", "v0.1.0", "-m", "release");
  assert.equal(tagIdentityViolation(root, "v0.1.0"), null);
});

test("missing release tag is rejected", (t) => {
  const root = repository(t);
  assert.match(tagIdentityViolation(root, "v0.1.0"), /does not exist/);
});

test("dirty-tree rejection exercises Git state", (t) => {
  const root = repository(t);
  assert.equal(dirtyTreeViolation(root), null);
  mkdirSync(join(root, "source"));
  writeFileSync(join(root, "source/change.txt"), "dirty\n");
  assert.match(dirtyTreeViolation(root), /uncommitted changes/);
});

test("release dependency policy accepts exact versions only", () => {
  assert.equal(isExactVersion("2.11.4"), true);
  for (const value of ["latest", "^2.11.4", "~2.11.4", "git+https://example.invalid/x"]) {
    assert.equal(isExactVersion(value), false);
  }
});

test("GitHub is release-only authority and Forgejo has no competing packager", () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  assert.deepEqual(githubReleaseWorkflowViolations(projectRoot), []);
});

test("GitHub release workflow policy rejects floating actions and branch triggers", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const root = mkdtempSync(join(tmpdir(), "nian-pass-release-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, ".forgejo/workflows"), { recursive: true });
  writeFileSync(join(root, ".forgejo/workflows/quality.yml"), "name: Quality\n");
  const workflow = readFileSync(join(projectRoot, ".github/workflows/release.yml"), "utf8");
  writeFileSync(
    join(root, ".github/workflows/release.yml"),
    workflow
      .replace("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683", "actions/checkout@v4")
      .replace("    tags:\n", "    branches:\n"),
  );
  const violations = githubReleaseWorkflowViolations(root).join("\n");
  assert.match(violations, /branch push triggers are forbidden/);
  assert.match(violations, /full commit revision/);
  assert.match(violations, /must trigger on v\* tags/);
});
