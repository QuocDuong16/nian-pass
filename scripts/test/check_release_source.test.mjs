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

function repository(t, version = "0.1.0") {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-release-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "VERSION"), `${version}\n`);
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

test("RC tags must exactly match the authoritative prerelease VERSION", (t) => {
  const root = repository(t, "0.1.0-rc.3");
  assert.equal(tagViolation(root, "v0.1.0-rc.3"), null);
  assert.match(tagViolation(root, "v0.1.0"), /!= v0\.1\.0-rc\.3/);
});

test("a final VERSION rejects a prerelease tag", (t) => {
  const root = repository(t, "0.1.0");
  assert.match(tagViolation(root, "v0.1.0-rc.1"), /!= v0\.1\.0/);
});

test("an RC tag ref pointing to HEAD passes exact identity", (t) => {
  const root = repository(t, "0.1.0-rc.3");
  git(root, "tag", "v0.1.0-rc.3");
  assert.equal(tagIdentityViolation(root, "v0.1.0-rc.3"), null);
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

test("GitHub attestation verifies basename-only checksums from the release directory", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const root = mkdtempSync(join(tmpdir(), "nian-pass-attestation-cwd-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, ".forgejo/workflows"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, ".forgejo/workflows/quality.yml"), "name: Quality\n");
  writeFileSync(
    join(root, ".github/workflows/release.yml"),
    readFileSync(join(projectRoot, ".github/workflows/release.yml"), "utf8").replace(
      "(cd artifacts/release && sha256sum --check SHA256SUMS)",
      "sha256sum --check artifacts/release/SHA256SUMS",
    ),
  );
  writeFileSync(
    join(root, "scripts/release_publication.mjs"),
    readFileSync(join(projectRoot, "scripts/release_publication.mjs"), "utf8"),
  );

  assert.match(
    githubReleaseWorkflowViolations(root).join("\n"),
    /attestation must verify basename-only checksums from the canonical release directory/,
  );
});

test("GitHub release workflow policy rejects floating actions and branch triggers", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const root = mkdtempSync(join(tmpdir(), "nian-pass-release-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, ".forgejo/workflows"), { recursive: true });
  writeFileSync(
    join(root, ".forgejo/workflows/quality.yml"),
    "name: Quality\n",
  );
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

test("GitHub release workflow policy rejects publication authority bypasses", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const root = mkdtempSync(join(tmpdir(), "nian-pass-publication-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, ".forgejo/workflows"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, ".forgejo/workflows/quality.yml"), "name: Quality\n");
  const workflow = readFileSync(
    join(projectRoot, ".github/workflows/release.yml"),
    "utf8",
  )
    .replace(
      'publication_action="$(EXISTING_RELEASE_STATE="${release_state}" EXISTING_RELEASE_PRERELEASE="${existing_prerelease}" node scripts/release_publication.mjs)"',
      'publication_action="UPDATE_DRAFT"',
    )
    .replace(
      "PUBLISH_RELEASE: ${{ github.event_name == 'workflow_dispatch' && inputs.publish || false }}",
      "PUBLISH_RELEASE: ${{ inputs.publish }}",
    )
    .replace(
      'if test "${existing_draft}" != "true"; then',
      "if false; then",
    )
    .replace(
      '(cd release && sha256sum --check SHA256SUMS)',
      ": skip downloaded checksum verification",
    );
  writeFileSync(join(root, ".github/workflows/release.yml"), workflow);
  const helper = readFileSync(
    join(projectRoot, "scripts/release_publication.mjs"),
    "utf8",
  ).replace('publish && forgejoCiStatus !== "PASS"', "false");
  writeFileSync(join(root, "scripts/release_publication.mjs"), helper);

  const violations = githubReleaseWorkflowViolations(root).join("\n");
  assert.match(violations, /behavioral publication policy helper/);
  assert.match(violations, /tag-push release runs must remain draft-only/);
  assert.match(violations, /downloaded checksums before publication policy/);
  assert.match(violations, /draft asset replacement must recheck/);
  assert.match(
    violations,
    /publish=true must require Forgejo canonical CI PASS/,
  );
});

test("GitHub release workflow policy rejects hard-coded prerelease metadata", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const root = mkdtempSync(join(tmpdir(), "nian-pass-release-class-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, ".forgejo/workflows"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, ".forgejo/workflows/quality.yml"), "name: Quality\n");
  const workflow = readFileSync(
    join(projectRoot, ".github/workflows/release.yml"),
    "utf8",
  )
    .replace(
      'if test "${RELEASE_IS_PRERELEASE}" = "true"; then',
      "if true; then",
    )
    .replace(
      'gh release edit "${RELEASE_TAG}" --draft=false "--prerelease=${RELEASE_IS_PRERELEASE}"',
      'gh release edit "${RELEASE_TAG}" --draft=false --prerelease=true',
    );
  writeFileSync(join(root, ".github/workflows/release.yml"), workflow);
  writeFileSync(
    join(root, "scripts/release_publication.mjs"),
    readFileSync(join(projectRoot, "scripts/release_publication.mjs"), "utf8"),
  );

  const violations = githubReleaseWorkflowViolations(root).join("\n");
  assert.match(violations, /draft creation must mark only source-classified prereleases/);
  assert.match(violations, /publication must preserve the source-derived prerelease flag/);
});
