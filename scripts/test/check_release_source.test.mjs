import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
  cargoTomlEolPolicyViolations,
  githubReleaseWorkflowViolations,
  isExactVersion,
  normalizePolicyText,
  postBuildSourceViolations,
  sourcePolicyViolations,
  tagIdentityViolation,
  tagViolation,
  windowsNodeBootstrapViolations,
  windowsRuntimeDiagnosticWorkflowViolations,
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

function writeManifest(root, contents) {
  const manifest = join(root, "apps/desktop/src-tauri/Cargo.toml");
  mkdirSync(resolve(manifest, ".."), { recursive: true });
  writeFileSync(manifest, contents);
  return manifest;
}

function checkoutWithAutocrlf(root) {
  const checkout = mkdtempSync(join(tmpdir(), "nian-pass-eol-checkout-"));
  git(
    root,
    "-c",
    "core.autocrlf=true",
    "-c",
    "core.eol=crlf",
    "clone",
    "--quiet",
    root,
    checkout,
  );
  git(checkout, "config", "core.autocrlf", "true");
  git(checkout, "config", "core.eol", "crlf");
  return checkout;
}

function sourcePolicyFixture(t) {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const root = mkdtempSync(join(tmpdir(), "nian-pass-source-policy-"));
  rmSync(root, { recursive: true, force: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(projectRoot, "clone", "--quiet", projectRoot, root);
  return root;
}

function workflowFixture(t, workflow, prefix = "nian-pass-workflow-policy-") {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, ".forgejo/workflows"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, ".forgejo/workflows/quality.yml"),
    "name: Quality\n",
  );
  writeFileSync(join(root, ".github/workflows/release.yml"), workflow);
  for (const name of [
    "release_publication.mjs",
    "release_publish_transaction.mjs",
    "release_execution_mode.mjs",
    "release_artifacts.mjs",
    "github_release_state.mjs",
    "github_release_identity.mjs",
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
  assert.match(dirtyTreeViolation(root), /\?\? source\/change\.txt/);
});

test("actual repository has the effective deterministic Cargo.toml LF policy", () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  assert.deepEqual(cargoTomlEolPolicyViolations(projectRoot), []);
  assert.deepEqual(
    git(
      projectRoot,
      "check-attr",
      "text",
      "eol",
      "--",
      "apps/desktop/src-tauri/Cargo.toml",
    ).split("\n"),
    [
      "apps/desktop/src-tauri/Cargo.toml: text: set",
      "apps/desktop/src-tauri/Cargo.toml: eol: lf",
    ],
  );
});

test("source policy rejects absent or non-LF Cargo.toml attributes", (t) => {
  const cases = [
    [
      "missing attributes",
      null,
      /\.gitattributes: deterministic Cargo\.toml LF policy is missing/,
    ],
    [
      "CRLF attribute",
      "apps/desktop/src-tauri/Cargo.toml text eol=crlf\n",
      /Git eol attribute must be lf/,
    ],
    [
      "missing EOL attribute",
      "apps/desktop/src-tauri/Cargo.toml text\n",
      /Git eol attribute must be lf/,
    ],
  ];
  for (const [name, attributes, expected] of cases) {
    const root = sourcePolicyFixture(t);
    const path = join(root, ".gitattributes");
    if (attributes === null) rmSync(path);
    else writeFileSync(path, attributes);
    assert.match(sourcePolicyViolations(root).join("\n"), expected, name);
  }
});

test("Cargo.toml has a deterministic LF checkout under Windows autocrlf", (t) => {
  const root = repository(t);
  const manifest = writeManifest(
    root,
    '[package]\nname = "nian-pass-desktop"\n',
  );
  writeFileSync(
    join(root, ".gitattributes"),
    "apps/desktop/src-tauri/Cargo.toml text eol=lf\n",
  );
  git(root, "add", ".gitattributes", "apps/desktop/src-tauri/Cargo.toml");
  git(root, ...identity, "commit", "--quiet", "-m", "canonical manifest eol");

  const checkout = checkoutWithAutocrlf(root);
  t.after(() => rmSync(checkout, { recursive: true, force: true }));
  const checkoutManifest = join(checkout, "apps/desktop/src-tauri/Cargo.toml");
  assert.equal(
    readFileSync(checkoutManifest, "utf8"),
    '[package]\nname = "nian-pass-desktop"\n',
  );

  // Simulate the pinned Tauri TOML writer's canonical LF serialization.
  writeFileSync(checkoutManifest, '[package]\nname = "nian-pass-desktop"\n');
  assert.equal(dirtyTreeViolation(checkout), null);
});

test("without the manifest attribute, a canonical LF rewrite dirties a CRLF checkout", (t) => {
  const root = repository(t);
  const manifest = writeManifest(
    root,
    '[package]\nname = "nian-pass-desktop"\n',
  );
  git(root, "add", manifest);
  git(
    root,
    ...identity,
    "commit",
    "--quiet",
    "-m",
    "manifest without eol policy",
  );

  const checkout = checkoutWithAutocrlf(root);
  t.after(() => rmSync(checkout, { recursive: true, force: true }));
  const checkoutManifest = join(checkout, "apps/desktop/src-tauri/Cargo.toml");
  assert.match(readFileSync(checkoutManifest, "utf8"), /\r\n/);
  writeFileSync(checkoutManifest, '[package]\nname = "nian-pass-desktop"\n');
  assert.match(
    dirtyTreeViolation(checkout),
    /apps\/desktop\/src-tauri\/Cargo\.toml/,
  );
});

test("post-build validation rejects a semantic Cargo.toml mutation", (t) => {
  const root = repository(t);
  const manifest = writeManifest(root, '[package]\nversion = "0.1.0"\n');
  git(root, "add", manifest);
  git(root, ...identity, "commit", "--quiet", "-m", "authoritative manifest");
  git(root, "tag", "v0.1.0");
  const expected = {
    tag: "v0.1.0",
    commit: git(root, "rev-parse", "HEAD"),
    version: "0.1.0",
  };

  writeFileSync(manifest, '[package]\nversion = "9.9.9"\n');
  assert.match(
    postBuildSourceViolations(root, expected).join("\n"),
    /post-build mutation rejected:[\s\S]*apps\/desktop\/src-tauri\/Cargo\.toml/,
  );
});

function ignoredByGit(root, path) {
  return (
    spawnSync("git", ["check-ignore", "--quiet", "--", path], {
      cwd: root,
      encoding: "utf8",
    }).status === 0
  );
}

test("actual Tauri-generated Android Kotlin is ignored while authoritative Kotlin remains protected", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const generated = [
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/generated/RustWebView.kt",
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/generated/WryActivity.kt",
  ];
  for (const path of generated)
    assert.equal(
      ignoredByGit(projectRoot, path),
      true,
      `${path} must be ignored`,
    );
  assert.equal(
    ignoredByGit(
      projectRoot,
      "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/VaultSourcePlugin.kt",
    ),
    false,
  );

  const root = repository(t);
  git(root, "tag", "v0.1.0");
  const appRoot = join(root, "apps/desktop/src-tauri/gen/android/app");
  mkdirSync(appRoot, { recursive: true });
  writeFileSync(join(appRoot, ".gitignore"), "/src/main/**/generated\n");
  git(root, "add", "apps/desktop/src-tauri/gen/android/app/.gitignore");
  git(root, ...identity, "commit", "--quiet", "-m", "ignore generated state");
  git(root, "tag", "-d", "v0.1.0");
  git(root, "tag", "v0.1.0");
  const sourceRoot = join(appRoot, "src/main/java/dev/nian/pass");
  mkdirSync(join(sourceRoot, "generated"), { recursive: true });
  writeFileSync(join(sourceRoot, "generated/RustWebView.kt"), "generated\n");
  writeFileSync(join(sourceRoot, "generated/WryActivity.kt"), "generated\n");
  const expected = {
    tag: "v0.1.0",
    commit: git(root, "rev-parse", "HEAD"),
    version: "0.1.0",
  };
  assert.deepEqual(postBuildSourceViolations(root, expected), []);

  writeFileSync(join(sourceRoot, "VaultSourcePlugin.kt"), "unexpected\n");
  assert.match(
    postBuildSourceViolations(root, expected).join("\n"),
    /post-build mutation rejected:[\s\S]*VaultSourcePlugin\.kt/,
  );
});

test("Kotlin compiler session state is ignored while Android source mutations fail closed", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const sessions = [
    "apps/desktop/src-tauri/gen/android/.kotlin/sessions/kotlin-compiler-test.salive",
    "apps/desktop/src-tauri/gen/android/buildSrc/.kotlin/sessions/kotlin-compiler-test.salive",
  ];
  for (const path of sessions)
    assert.equal(
      ignoredByGit(projectRoot, path),
      true,
      `${path} must be ignored`,
    );

  const root = repository(t);
  const androidRoot = join(root, "apps/desktop/src-tauri/gen/android");
  mkdirSync(androidRoot, { recursive: true });
  writeFileSync(join(androidRoot, ".gitignore"), ".kotlin\n");
  git(root, "add", "apps/desktop/src-tauri/gen/android/.gitignore");
  git(root, ...identity, "commit", "--quiet", "-m", "ignore Kotlin sessions");
  git(root, "tag", "v0.1.0");
  for (const path of sessions) {
    const absolute = join(root, path);
    mkdirSync(resolve(absolute, ".."), { recursive: true });
    writeFileSync(absolute, "transient\n");
  }
  const expected = {
    tag: "v0.1.0",
    commit: git(root, "rev-parse", "HEAD"),
    version: "0.1.0",
  };
  assert.equal(dirtyTreeViolation(root), null);
  assert.deepEqual(postBuildSourceViolations(root, expected), []);

  const source = join(
    androidRoot,
    "app/src/main/java/dev/nian/pass/VaultSourcePlugin.kt",
  );
  mkdirSync(resolve(source, ".."), { recursive: true });
  writeFileSync(source, "unexpected\n");
  assert.match(
    postBuildSourceViolations(root, expected).join("\n"),
    /VaultSourcePlugin\.kt/,
  );
});

test("post-build validation keeps tag, HEAD, and VERSION bound to pre-build identity", (t) => {
  const root = repository(t);
  git(root, "tag", "v0.1.0");
  const expected = {
    tag: "v0.1.0",
    commit: git(root, "rev-parse", "HEAD"),
    version: "0.1.0",
  };
  assert.deepEqual(postBuildSourceViolations(root, expected), []);

  commitChange(root);
  assert.match(
    postBuildSourceViolations(root, expected).join("\n"),
    /not HEAD|expected commit/,
  );
  writeFileSync(join(root, "VERSION"), "0.1.1\n");
  assert.match(
    postBuildSourceViolations(root, expected).join("\n"),
    /expected version 0\.1\.0/,
  );
});

test("Android release staging uses pre-build clean verification and post-build mutation validation", () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const makefile = readFileSync(join(projectRoot, "Makefile"), "utf8");
  assert.match(
    makefile,
    /release-browser-package release-linux-build release-android-build release-gateway-image: private RELEASE_COMMIT := \$\(shell git rev-parse HEAD\)/,
  );
  assert.match(
    makefile,
    /release-browser-package release-linux-build release-android-build release-gateway-image: private RELEASE_VERSION := \$\(shell cat VERSION\)/,
  );
  assert.match(
    makefile,
    /release-android-build: release-source-check mobile-android-check[\s\S]*?\$\(MAKE\) release-stage/,
  );
  assert.match(
    makefile,
    /release-stage: release-source-postbuild-check\n\tnode scripts\/stage_release\.mjs/,
  );
  assert.doesNotMatch(makefile, /release-stage: release-source-check/);
  assert.match(
    makefile,
    /release-browser-package: release-source-check[\s\S]*?release-source-postbuild-check/,
  );
  assert.match(
    makefile,
    /release-linux-build: release-source-check[\s\S]*?\$\(MAKE\) release-stage/,
  );
  assert.match(
    makefile,
    /release-gateway-image: release-source-check[\s\S]*?release-source-postbuild-check/,
  );
  assert.doesNotMatch(
    makefile,
    /RELEASE_COMMIT="\$\$\(git rev-parse HEAD\)" RELEASE_VERSION="\$\$\(cat VERSION\)" \$\(MAKE\) release-(?:stage|source-postbuild-check)/,
  );
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

test("manual Windows runtime diagnostic workflow is narrowly constrained", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  assert.deepEqual(windowsRuntimeDiagnosticWorkflowViolations(projectRoot), []);

  const root = mkdtempSync(
    join(tmpdir(), "nian-pass-windows-runtime-diagnostic-"),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  const workflowPath = join(
    root,
    ".github/workflows/windows-runtime-diagnostic.yml",
  );
  const workflow = readFileSync(
    join(projectRoot, ".github/workflows/windows-runtime-diagnostic.yml"),
    "utf8",
  );
  writeFileSync(
    join(root, "scripts/bootstrap_windows_node_tools.ps1"),
    readFileSync(
      join(projectRoot, "scripts/bootstrap_windows_node_tools.ps1"),
      "utf8",
    ),
  );
  writeFileSync(
    workflowPath,
    workflow.replace("contents: read", "contents: write"),
  );
  assert.match(
    windowsRuntimeDiagnosticWorkflowViolations(root).join("\n"),
    /contents: read/,
  );
  writeFileSync(
    workflowPath,
    workflow.replace(
      "      - name: Install pinned Node\n        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n        with:\n          node-version: ${{ env.NODE_VERSION }}\n",
      "",
    ),
  );
  assert.match(
    windowsRuntimeDiagnosticWorkflowViolations(root).join("\n"),
    /production-pinned setup-node action/,
  );
  const setupNodeStep =
    "      - name: Install pinned Node\n        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n        with:\n          node-version: ${{ env.NODE_VERSION }}\n";
  writeFileSync(
    workflowPath,
    `${workflow.replace(setupNodeStep, "")}\n${setupNodeStep}`,
  );
  assert.match(
    windowsRuntimeDiagnosticWorkflowViolations(root).join("\n"),
    /setup-node must run after checkout and before the private Corepack\/pnpm bootstrap/,
  );
  writeFileSync(
    workflowPath,
    workflow.replace(
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      "actions/setup-node@v4",
    ),
  );
  assert.match(
    windowsRuntimeDiagnosticWorkflowViolations(root).join("\n"),
    /production-pinned setup-node action/,
  );
  writeFileSync(
    workflowPath,
    workflow.replace(
      "  workflow_dispatch:",
      "  push:\n    branches: [main]\n  workflow_dispatch:",
    ),
  );
  assert.match(
    windowsRuntimeDiagnosticWorkflowViolations(root).join("\n"),
    /push, pull_request, and schedule triggers are forbidden/,
  );
  writeFileSync(
    workflowPath,
    workflow.replace("$env:NIAN_PASS_WINDOWS_CLOSE_TRACE = $closeTrace", ""),
  );
  assert.match(
    windowsRuntimeDiagnosticWorkflowViolations(root).join("\n"),
    /scope the close trace environment/,
  );
  writeFileSync(
    workflowPath,
    workflow.replace("if: always()", "if: success()"),
  );
  assert.match(
    windowsRuntimeDiagnosticWorkflowViolations(root).join("\n"),
    /always upload the short-retention close trace artifact/,
  );
});

test("shared Windows Node bootstrap is private, pinned, and fail-closed", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  assert.deepEqual(windowsNodeBootstrapViolations(projectRoot), []);

  const root = mkdtempSync(join(tmpdir(), "nian-pass-windows-node-tools-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"), { recursive: true });
  const helperPath = join(root, "scripts/bootstrap_windows_node_tools.ps1");
  const helper = readFileSync(
    join(projectRoot, "scripts/bootstrap_windows_node_tools.ps1"),
    "utf8",
  );

  writeFileSync(
    helperPath,
    helper.replace(
      '$actualNode -ne $expectedNode',
      '$actualNode -eq $expectedNode',
    ),
  );
  assert.match(
    windowsNodeBootstrapViolations(root).join("\n"),
    /unexpected Node version/,
  );

  writeFileSync(
    helperPath,
    helper.replace(
      'Assert-PrivateToolCommand "corepack" $toolRoot',
      '$corepackPath = "C:\\npm\\prefix\\corepack.cmd"',
    ),
  );
  assert.match(
    windowsNodeBootstrapViolations(root).join("\n"),
    /private Corepack executable/,
  );

  writeFileSync(
    helperPath,
    helper.replace(
      'Assert-PrivateToolCommand "pnpm" $toolRoot',
      '$pnpmPath = "C:\\npm\\prefix\\pnpm.cmd"',
    ),
  );
  assert.match(
    windowsNodeBootstrapViolations(root).join("\n"),
    /private pnpm executable/,
  );

  writeFileSync(
    helperPath,
    helper.replace(
      '$pnpmVersion -ne $env:PNPM_VERSION',
      '$pnpmVersion -eq $env:PNPM_VERSION',
    ),
  );
  assert.match(
    windowsNodeBootstrapViolations(root).join("\n"),
    /exact pnpm version/,
  );

  writeFileSync(
    helperPath,
    helper.replace(
      '$env:NODE_OPTIONS = "--require=$guardPath"',
      '$env:NODE_OPTIONS = ""',
    ),
  );
  assert.match(
    windowsNodeBootstrapViolations(root).join("\n"),
    /pnpm runtime Node guard/,
  );

  writeFileSync(
    helperPath,
    helper.replace(
      'process.version !== `v${expected}`',
      'process.version === `v${expected}`',
    ),
  );
  assert.match(
    windowsNodeBootstrapViolations(root).join("\n"),
    /unexpected pnpm runtime Node version/,
  );

  writeFileSync(
    helperPath,
    helper.replace(
      'npm install --global --prefix $toolRoot "corepack@$env:COREPACK_VERSION"',
      'npm install --global "corepack@$env:COREPACK_VERSION"',
    ),
  );
  assert.match(
    windowsNodeBootstrapViolations(root).join("\n"),
    /explicit private npm prefix|runner-global Corepack installation/,
  );

  writeFileSync(
    helperPath,
    helper.replace(
      '$PSNativeCommandUseErrorActionPreference = $true',
      '$PSNativeCommandUseErrorActionPreference = $false',
    ),
  );
  assert.match(
    windowsNodeBootstrapViolations(root).join("\n"),
    /native command errors/,
  );
});

test("policy text normalization is LF, CRLF, and CR independent", () => {
  assert.equal(normalizePolicyText("a\nb\n"), "a\nb\n");
  assert.equal(normalizePolicyText("a\r\nb\r\n"), "a\nb\n");
  assert.equal(normalizePolicyText("a\rb\r"), "a\nb\n");
});

test("canonical release workflow has identical policy results under LF, CRLF, and CR", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const workflow = readFileSync(
    join(projectRoot, ".github/workflows/release.yml"),
    "utf8",
  );
  const lfRoot = workflowFixture(t, workflow, "nian-pass-lf-workflow-");
  const crlfRoot = workflowFixture(
    t,
    workflow.replace(/\n/g, "\r\n"),
    "nian-pass-crlf-workflow-",
  );
  const crRoot = workflowFixture(
    t,
    workflow.replace(/\n/g, "\r"),
    "nian-pass-cr-workflow-",
  );
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
    assert.ok(
      !githubReleaseWorkflowViolations(crlfRoot).some((item) =>
        item.includes(violation),
      ),
    );
  }
});

test("CRLF workflow policy still detects a real build-mode violation", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const workflow = normalizePolicyText(
    readFileSync(join(projectRoot, ".github/workflows/release.yml"), "utf8"),
  ).replace(
    "  linux:\n    needs: preflight\n    if: ${{ needs.preflight.outputs.build_mode == 'true' }}\n",
    "  linux:\n    needs: preflight\n",
  );
  const root = workflowFixture(
    t,
    workflow.replace(/\n/g, "\r\n"),
    "nian-pass-crlf-violation-",
  );
  assert.match(
    githubReleaseWorkflowViolations(root).join("\n"),
    /linux must run only in build\/stage mode/,
  );
});

test("GitHub release workflow requires separate Windows shutdown evidence", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const workflow = readFileSync(
    join(projectRoot, ".github/workflows/release.yml"),
    "utf8",
  );
  const missingOutput = workflowFixture(
    t,
    workflow.replace(
      "desktop_shutdown_smoke: ${{ steps.build.outputs.desktop_shutdown_smoke }}",
      "",
    ),
    "nian-pass-missing-windows-shutdown-output-",
  );
  assert.match(
    githubReleaseWorkflowViolations(missingOutput).join("\n"),
    /Windows job must expose desktop shutdown smoke output/,
  );
  const missingAttestation = workflowFixture(
    t,
    workflow.replace(
      "WINDOWS_DESKTOP_SHUTDOWN_STATUS: ${{ needs.windows.outputs.desktop_shutdown_smoke }}",
      "",
    ),
    "nian-pass-missing-windows-shutdown-attestation-",
  );
  assert.match(
    githubReleaseWorkflowViolations(missingAttestation).join("\n"),
    /attestation must pass desktop shutdown smoke to release status/,
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

test("GitHub release workflow policy rejects published-release-by-tag draft discovery", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const workflow = readFileSync(
    join(projectRoot, ".github/workflows/release.yml"),
    "utf8",
  ).replace(
    'gh api --paginate --slurp "repos/${GITHUB_REPOSITORY}/releases" | node scripts/github_release_state.mjs tsv',
    'gh api "repos/${GITHUB_REPOSITORY}/releases/tags/${RELEASE_TAG}"',
  );
  const root = workflowFixture(
    t,
    workflow,
    "nian-pass-draft-discovery-policy-",
  );
  const violations = githubReleaseWorkflowViolations(root).join("\n");
  assert.match(
    violations,
    /published-release-by-tag discovery cannot resolve drafts/,
  );
});

test("GitHub release workflow policy rejects unsafe release asset and metadata HTTP semantics", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const workflow = readFileSync(
    join(projectRoot, ".github/workflows/release.yml"),
    "utf8",
  )
    .replace(
      "-H 'Content-Type: application/octet-stream' \\\n                ",
      "",
    )
    .replace('-F "body=@$1"', "--input -")
    .replace(
      '-F draft=false \\\n              -F "prerelease=${RELEASE_IS_PRERELEASE}"',
      "--input -",
    );
  const root = workflowFixture(t, workflow, "nian-pass-release-http-policy-");
  const violations = githubReleaseWorkflowViolations(root).join("\n");
  assert.match(
    violations,
    /explicit binary Content-Type, raw body, and suppress successful response noise/,
  );
  assert.match(
    violations,
    /release notes PATCH must bind source tag\/commit and validate its draft response/,
  );
  assert.match(
    violations,
    /release publication PATCH must bind source tag\/commit and validate its published response/,
  );
});

test("GitHub release workflow policy rejects unpinned mutation and tag rediscovery", (t) => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const workflow = readFileSync(
    join(projectRoot, ".github/workflows/release.yml"),
    "utf8",
  )
    .replace(
      '-F "tag_name=${RELEASE_TAG}" \\\n              -F "target_commitish=${RELEASE_COMMIT}" \\\n              -F "body=@$1"',
      '-F "body=@$1"',
    )
    .replace(
      'gh api "repos/${GITHUB_REPOSITORY}/releases/${RELEASE_ID}" | node scripts/github_release_identity.mjs tsv',
      'gh api --paginate --slurp "repos/${GITHUB_REPOSITORY}/releases" | node scripts/github_release_state.mjs tsv',
    );
  const root = workflowFixture(
    t,
    workflow,
    "nian-pass-release-identity-policy-",
  );
  const violations = githubReleaseWorkflowViolations(root).join("\n");
  assert.match(
    violations,
    /release notes PATCH must bind source tag\/commit and validate its draft response/,
  );
  assert.match(
    violations,
    /transactional release observation must use the resolved numeric release ID and validate exact identity/,
  );
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
  assert.match(
    violations,
    /validate the downloaded DRAFT and isolated PASS candidate/,
  );
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
  writeFileSync(
    join(root, ".forgejo/workflows/quality.yml"),
    "name: Quality\n",
  );
  const workflow = readFileSync(
    join(projectRoot, ".github/workflows/release.yml"),
    "utf8",
  )
    .replaceAll("if: ${{ needs.preflight.outputs.build_mode == 'true' }}", "")
    .replace(
      "gh api -H 'Accept: application/octet-stream' \"repos/${GITHUB_REPOSITORY}/releases/assets/${asset_id}\"",
      ": current-run artifacts are enough",
    )
    .replace(
      'release_upload "${candidate_metadata[@]}"',
      "release_upload release-publish-candidate/*",
    );
  writeFileSync(join(root, ".github/workflows/release.yml"), workflow);
  for (const name of [
    "release_publication.mjs",
    "release_publish_transaction.mjs",
    "github_release_state.mjs",
  ]) {
    writeFileSync(
      join(root, "scripts", name),
      readFileSync(join(projectRoot, "scripts", name), "utf8"),
    );
  }
  const violations = githubReleaseWorkflowViolations(root).join("\n");
  assert.match(violations, /linux must run only in build\/stage mode/);
  assert.match(violations, /attest must run only in build\/stage mode/);
  assert.match(
    violations,
    /publish=true must download assets from the existing GitHub draft/,
  );
  assert.match(
    violations,
    /candidate upload must recheck the observed remote draft state and mutate metadata only/,
  );
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
      '-F draft=false \\\n              -F "prerelease=${RELEASE_IS_PRERELEASE}"',
      '-F draft=false \\\n              -F "prerelease=true"',
    );
  writeFileSync(join(root, ".github/workflows/release.yml"), workflow);
  writeFileSync(
    join(root, "scripts/release_publication.mjs"),
    readFileSync(join(projectRoot, "scripts/release_publication.mjs"), "utf8"),
  );
  writeFileSync(
    join(root, "scripts/github_release_state.mjs"),
    readFileSync(join(projectRoot, "scripts/github_release_state.mjs"), "utf8"),
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
