import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  dirtyTreeViolation,
  githubReleaseWorkflowViolations,
  isExactVersion,
  normalizePolicyText,
  tagIdentityViolation,
  tagViolation,
} from "../check_release_source.mjs";

const identity = [
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.invalid",
];

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

function workflowFixture(t, workflow, prefix = "nian-pass-workflow-policy-") {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, ".forgejo/workflows"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, ".forgejo/workflows/quality.yml"), "name: Quality\n");
  writeFileSync(join(root, ".github/workflows/release.yml"), workflow);
  for (const name of [
    "release_publication.mjs",
    "release_publish_transaction.mjs",
    "release_execution_mode.mjs",
    "release_artifacts.mjs",
  ]) {
    writeFileSync(
      join(root, "scripts", name),
      readFileSync(join(projectRoot, "scripts", name), "utf8"),
    );
  }
  return root;
}

test("tag must match the authoritative VERSION", (t) => {
  const root = repository(t);
  assert.equal(tagViolation(root, "v0.1.0"), null);
  assert.match(tagViolation(root, "v0.1.1"), /!= v0\.1\.0/);
});

test("RC tags must exactly match the authoritative prerelease VERSION", (t) => {
  const root = repository(t, "0.1.0-rc.4");
  assert.equal(tagViolation(root, "v0.1.0-rc.4"), null);
  assert.match(tagViolation(root, "v0.1.0"), /!= v0\.1\.0-rc\.4/);
});

test("a final VERSION rejects a prerelease tag", (t) => {
  const root = repository(t, "0.1.0");
  assert.match(tagViolation(root, "v0.1.0-rc.1"), /!= v0\.1\.0/);
});

test("an RC tag ref pointing to HEAD passes exact identity", (t) => {
  const root = repository(t, "0.1.0-rc.4");
  git(root, "tag", "v0.1.0-rc.4");
  assert.equal(tagIdentityViolation(root, "v0.1.0-rc.4"), null);
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
  for (const value of [
    "latest",
    "^2.11.4",
    "~2.11.4",
    "git+https://example.invalid/x",
  ]) {
    assert.equal(isExactVersion(value), false);
  }
});

test("GitHub is release-only authority and Forgejo has no competing packager", () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  assert.deepEqual(githubReleaseWorkflowViolations(projectRoot), []);
});

test("policy text normalization is LF, CRLF, and CR independent", () => {
  assert.equal(normalizePolicyText("a\nb\n"), "a\nb\n");
  assert.equal(normalizePolicyText("a\r\nb\r\n"), "a\nb\n");
  assert.equal(normalizePolicyText("a\rb\r"), "a\nb\n");
});

test("canonical release workflow has identical policy results under LF, CRLF, and CR", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const workflow = readFileSync(join(projectRoot, ".github/workflows/release.yml"), "utf8");
  const lfRoot = workflowFixture(t, workflow, "nian-pass-lf-workflow-");
  const crlfRoot = workflowFixture(
    t,
    workflow.replace(/\n/g, "\r\n"),
    "nian-pass-crlf-workflow-",
  );
  const crRoot = workflowFixture(t, workflow.replace(/\n/g, "\r"), "nian-pass-cr-workflow-");
  const expected = githubReleaseWorkflowViolations(lfRoot);
  assert.deepEqual(expected, []);
  assert.deepEqual(githubReleaseWorkflowViolations(crlfRoot), expected);
  assert.deepEqual(githubReleaseWorkflowViolations(crRoot), expected);
  const falsePositives = [
    "linux must run only in build/stage mode",
    "windows must run only in build/stage mode",
    "browser must run only in build/stage mode",
    "android must run only in build/stage mode",
    "gateway must run only in build/stage mode",
    "attest must run only in build/stage mode",
    "only build/stage mode may use current-run Actions artifacts",
    "publish=true must download assets from the existing GitHub draft",
  ];
  for (const violation of falsePositives) {
    assert.ok(!githubReleaseWorkflowViolations(crlfRoot).some((item) => item.includes(violation)));
  }
});

test("CRLF workflow policy still detects a real build-mode violation", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const workflow = normalizePolicyText(
    readFileSync(join(projectRoot, ".github/workflows/release.yml"), "utf8"),
  )
    .replace("  linux:\n    needs: preflight\n    if: ${{ needs.preflight.outputs.build_mode == 'true' }}\n", "  linux:\n    needs: preflight\n");
  const root = workflowFixture(t, workflow.replace(/\n/g, "\r\n"), "nian-pass-crlf-violation-");
  assert.match(
    githubReleaseWorkflowViolations(root).join("\n"),
    /linux must run only in build\/stage mode/,
  );
});

test("GitHub attestation verifies basename-only checksums from the release directory", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const root = mkdtempSync(
    join(tmpdir(), "nian-pass-attestation-cwd-workflow-"),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, ".forgejo/workflows"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, ".forgejo/workflows/quality.yml"),
    "name: Quality\n",
  );
  writeFileSync(
    join(root, ".github/workflows/release.yml"),
    readFileSync(
      join(projectRoot, ".github/workflows/release.yml"),
      "utf8",
    ).replace(
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
  const workflow = readFileSync(
    join(projectRoot, ".github/workflows/release.yml"),
    "utf8",
  );
  writeFileSync(
    join(root, ".github/workflows/release.yml"),
    workflow
      .replace(
        "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
        "actions/checkout@v4",
      )
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
  writeFileSync(
    join(root, ".forgejo/workflows/quality.yml"),
    "name: Quality\n",
  );
  const workflow = readFileSync(
    join(projectRoot, ".github/workflows/release.yml"),
    "utf8",
  )
    .replace(
      'publication_action="$(EXISTING_RELEASE_STATE="${release_state}" EXISTING_RELEASE_PRERELEASE="${existing_prerelease}" node scripts/release_publication.mjs)"',
      'publication_action="UPDATE_DRAFT"',
    )
    .replaceAll(
      "PUBLISH_RELEASE: ${{ github.event_name == 'workflow_dispatch' && inputs.publish || false }}",
      "PUBLISH_RELEASE: ${{ inputs.publish }}",
    )
    .replace('if test "${existing_draft}" != "true"; then', "if false; then")
    .replace(
      'RELEASE_PUBLICATION_STATUS=DRAFT ARTIFACT_DIR="${GITHUB_WORKSPACE}/release" node scripts/release_artifacts.mjs validate-snapshot',
      ": skip downloaded manifest and checksum verification",
    )
    .replace(
      "cp -a -- release release-publish-candidate",
      ": mutate the only downloaded snapshot",
    );
  writeFileSync(join(root, ".github/workflows/release.yml"), workflow);
  const helper = readFileSync(
    join(projectRoot, "scripts/release_publication.mjs"),
    "utf8",
  ).replace('publish && forgejoCiStatus !== "PASS"', "false");
  writeFileSync(join(root, "scripts/release_publication.mjs"), helper);
  writeFileSync(
    join(root, "scripts/release_publish_transaction.mjs"),
    readFileSync(
      join(projectRoot, "scripts/release_publish_transaction.mjs"),
      "utf8",
    ),
  );

  const violations = githubReleaseWorkflowViolations(root).join("\n");
  assert.match(violations, /behavioral publication policy helper/);
  assert.match(violations, /tag-push release runs must remain draft-only/);
  assert.match(violations, /validate the downloaded DRAFT and isolated PASS candidate/);
  assert.match(
    violations,
    /publication must retain an exact local DRAFT snapshot/,
  );
  assert.match(
    violations,
    /publish=true must require Forgejo canonical CI PASS/,
  );
});

test("GitHub release workflow policy rejects publish-only rebuilds and broad payload mutation", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const root = mkdtempSync(join(tmpdir(), "nian-pass-publish-only-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, ".forgejo/workflows"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, ".forgejo/workflows/quality.yml"), "name: Quality\n");
  const workflow = readFileSync(join(projectRoot, ".github/workflows/release.yml"), "utf8")
    .replaceAll("if: ${{ needs.preflight.outputs.build_mode == 'true' }}", "")
    .replace(
      'gh release download "${RELEASE_TAG}" --dir release',
      ': current-run artifacts are enough',
    )
    .replace(
      'gh release upload "${RELEASE_TAG}" --clobber "${candidate_metadata[@]}"',
      'gh release upload "${RELEASE_TAG}" --clobber release-publish-candidate/*',
    );
  writeFileSync(join(root, ".github/workflows/release.yml"), workflow);
  for (const name of [
    "release_publication.mjs",
    "release_publish_transaction.mjs",
  ]) {
    writeFileSync(
      join(root, "scripts", name),
      readFileSync(join(projectRoot, "scripts", name), "utf8"),
    );
  }
  const violations = githubReleaseWorkflowViolations(root).join("\n");
  assert.match(violations, /linux must run only in build\/stage mode/);
  assert.match(violations, /attest must run only in build\/stage mode/);
  assert.match(violations, /publish=true must download assets from the existing GitHub draft/);
  assert.match(violations, /candidate upload must recheck the observed remote draft state and mutate metadata only/);
});

test("GitHub release workflow policy rejects hard-coded prerelease metadata", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const root = mkdtempSync(join(tmpdir(), "nian-pass-release-class-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, ".forgejo/workflows"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, ".forgejo/workflows/quality.yml"),
    "name: Quality\n",
  );
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
  assert.match(
    violations,
    /draft creation must mark only source-classified prereleases/,
  );
  assert.match(
    violations,
    /publication must preserve the source-derived prerelease flag/,
  );
});
