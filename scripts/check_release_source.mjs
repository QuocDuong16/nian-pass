import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parse as parseToml } from "smol-toml";

import { isReleaseVersion } from "./release_version.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const versionFiles = [
  ["apps/cli/Cargo.toml", "toml"],
  ["apps/browser-native-host/Cargo.toml", "toml"],
  ["apps/desktop/src-tauri/Cargo.toml", "toml"],
  ["apps/sync-gateway/Cargo.toml", "toml"],
  ["apps/desktop/package.json", "json"],
  ["apps/browser-extension/package.json", "json"],
  ["apps/desktop/src-tauri/tauri.conf.json", "json"],
];

function read(root, name) {
  return readFileSync(resolve(root, name), "utf8");
}

/** Normalize policy source only; release payload and checksum bytes stay raw. */
export function normalizePolicyText(text) {
  return text.replace(/\r\n?/g, "\n");
}

function readPolicyText(root, name) {
  return normalizePolicyText(read(root, name));
}

function workflowJobBlock(workflow, job) {
  const header = new RegExp(`^  ${job}:[ \\t]*$`, "m").exec(workflow);
  if (!header || header.index === undefined) return "";

  const afterHeader = workflow.slice(header.index + header[0].length);
  const nextHeader = /^  [A-Za-z0-9_-]+:[ \t]*$/m.exec(afterHeader);
  return nextHeader ? afterHeader.slice(0, nextHeader.index) : afterHeader;
}

export function releaseVersion(root) {
  const version = read(root, "VERSION").trim();
  if (!isReleaseVersion(version)) {
    throw new Error("VERSION must contain one semantic version");
  }
  return version;
}

function dependencyRequirement(value) {
  return typeof value === "string" ? value : value?.version;
}

export function isExactVersion(value) {
  return isReleaseVersion(value);
}

export function githubReleaseWorkflowViolations(root) {
  const violations = [];
  const githubWorkflow = ".github/workflows/release.yml";
  const forgejoWorkflow = ".forgejo/workflows/release.yml";
  if (!existsSync(resolve(root, ".forgejo/workflows/quality.yml"))) {
    violations.push(
      ".forgejo/workflows/quality.yml: canonical routine CI workflow is missing",
    );
  }
  if (existsSync(resolve(root, forgejoWorkflow))) {
    violations.push(
      `${forgejoWorkflow}: Forgejo may not duplicate production release packaging`,
    );
  }
  if (!existsSync(resolve(root, githubWorkflow))) {
    violations.push(
      `${githubWorkflow}: GitHub production release workflow is missing`,
    );
    return violations;
  }

  const workflow = readPolicyText(root, githubWorkflow);
  const triggerBlock =
    workflow.match(/^on:\s*\n([\s\S]*?)^permissions:/m)?.[1] ?? "";
  const triggers = [...triggerBlock.matchAll(/^  ([A-Za-z0-9_-]+):/gm)].map(
    (match) => match[1],
  );
  if (
    triggers.length !== 2 ||
    !triggers.includes("push") ||
    !triggers.includes("workflow_dispatch")
  ) {
    violations.push(
      `${githubWorkflow}: only push.tags v* and workflow_dispatch triggers are allowed`,
    );
  }
  const require = (pattern, message) => {
    if (!pattern.test(workflow))
      violations.push(`${githubWorkflow}: ${message}`);
  };
  require(/^on:\s*\n[\s\S]*?^  push:\s*\n\s+tags:\s*\n\s+- ["']v\*["']/m, "must trigger on v* tags");
  require(/^  workflow_dispatch:\s*\n[\s\S]*?release_tag:[\s\S]*?required:\s*true/m, "manual dispatch must require a release_tag");
  require(/ref:\s*\$\{\{\s*format\(['"]refs\/tags\/\{0\}['"],\s*env\.RELEASE_TAG\)\s*\}\}/, "every checkout must select the explicit refs/tags namespace");
  require(/^permissions:\s*\n\s+contents:\s*read\s*$/m, "default permissions must be contents: read");
  for (const job of [
    "preflight",
    "linux",
    "windows",
    "browser",
    "android",
    "gateway",
    "attest",
    "publish",
  ]) {
    require(new RegExp(`^  ${job}:\\s*$`, "m"), `missing ${job} job`);
  }
  require(/^  windows:[\s\S]*?^    runs-on:\s*windows-/m, "Windows artifacts require a native Windows runner");
  require(/^  linux:[\s\S]*?^    runs-on:\s*ubuntu-/m, "Linux artifacts require a Linux runner");
  require(/^  android:[\s\S]*?^    runs-on:\s*ubuntu-/m, "Android artifacts require a Linux runner");
  require(/^  publish:[\s\S]*?^    permissions:\s*\n\s+contents:\s*write/m, "only publish must receive release write authority");
  require(/GITHUB_RELEASE_STATUS:\s*DRAFT/, "attestation must record draft status before publication policy runs");
  require(/node scripts\/assemble_release\.mjs[\s\S]*?release_artifacts\.mjs scan[\s\S]*?release_status\.mjs[\s\S]*?release_artifacts\.mjs sbom[\s\S]*?release_artifacts\.mjs manifest[\s\S]*?release_artifacts\.mjs checksums/, "attestation metadata must be generated in non-circular integrity order");
  require(/release_artifacts\.mjs checksums\s*\n\s*\(cd artifacts\/release && sha256sum --check SHA256SUMS\)/, "attestation must verify basename-only checksums from the canonical release directory");
  require(/node scripts\/release_publication\.mjs/, "publish job must use the behavioral publication policy helper");
  require(/EXISTING_RELEASE_STATE="\$\{release_state\}"/, "publication policy must receive observed GitHub Release state");
  require(/EXISTING_RELEASE_PRERELEASE="\$\{existing_prerelease\}"/, "publication policy must receive observed draft classification");
  require(/release_kind:\s*\$\{\{ steps\.source\.outputs\.release_kind \}\}/, "preflight must classify the release version once");
  require(/build_mode:\s*\$\{\{ steps\.source\.outputs\.build_mode \}\}/, "preflight must resolve build versus publish-only mode once");
  require(/RELEASE_EVENT_NAME="\$\{GITHUB_EVENT_NAME\}" PUBLISH_RELEASE="\$\{PUBLISH_RELEASE\}" node scripts\/release_execution_mode\.mjs/, "preflight must use the tested build/publish execution-mode helper");
  for (const job of ["linux", "windows", "browser", "android", "gateway", "attest"]) {
    if (
      !/^    if: \$\{\{ needs\.preflight\.outputs\.build_mode == 'true' \}\}$/m.test(
        workflowJobBlock(workflow, job),
      )
    ) {
      violations.push(`${githubWorkflow}: ${job} must run only in build/stage mode`);
    }
  }
  require(/^  publish:[\s\S]*?^    needs: \[preflight, linux, windows, browser, android, gateway, attest\][\s\S]*?^    if: \$\{\{ always\(\) && needs\.preflight\.result == 'success' && \(needs\.preflight\.outputs\.build_mode == 'false' \|\| needs\.attest\.result == 'success'\) \}\}/m, "publish-only mode must not be skipped because build jobs are intentionally skipped");
  require(/RELEASE_KIND:\s*\$\{\{ needs\.preflight\.outputs\.release_kind \}\}/, "publish job must use the preflight release classification");
  require(/if test "\$\{RELEASE_IS_PRERELEASE\}" = "true"; then[\s\S]*?create_args\+=\(--prerelease\)/, "draft creation must mark only source-classified prereleases");
  require(/--draft=false "--prerelease=\$\{RELEASE_IS_PRERELEASE\}"/, "publication must preserve the source-derived prerelease flag");
  require(/test "\$\(git rev-parse HEAD\)" = "\$\{RELEASE_COMMIT\}"[\s\S]*?node scripts\/release_publication\.mjs/, "publish job must verify the preflight commit before publication policy");
  require(/PUBLISH_RELEASE:\s*\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.publish \|\| false \}\}/, "tag-push release runs must remain draft-only");
  require(/FORGEJO_CI_STATUS:\s*\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.forgejo_ci_status \|\| 'NOT RUN' \}\}/, "publication policy must receive the operator-observed Forgejo CI status");
  require(/Download current-run canonical release set for draft staging\n\s+if: \$\{\{ needs\.preflight\.outputs\.build_mode == 'true' \}\}[\s\S]*?actions\/download-artifact@/, "only build/stage mode may use current-run Actions artifacts");
  require(/Download existing validated GitHub draft assets for publication\n\s+if: \$\{\{ steps\.publication\.outputs\.action == 'UPDATE_AND_PUBLISH' \}\}[\s\S]*?gh release download "\$\{RELEASE_TAG\}" --dir release/, "publish=true must download assets from the existing GitHub draft");
  require(/cp -a -- release release-publish-candidate/, "publication must retain an exact local DRAFT snapshot before PASS candidate generation");
  require(/RELEASE_PUBLICATION_STATUS=DRAFT ARTIFACT_DIR="\$\{GITHUB_WORKSPACE\}\/release" node scripts\/release_artifacts\.mjs validate-snapshot[\s\S]*?FORGEJO_CI_STATUS="\$\{FORGEJO_CI_STATUS\}" ARTIFACT_DIR="\$\{GITHUB_WORKSPACE\}\/release-publish-candidate" node scripts\/release_artifacts\.mjs publication-status PASS[\s\S]*?RELEASE_PUBLICATION_STATUS=PASS[\s\S]*?validate-snapshot[\s\S]*?publication-candidate/, "publication must validate the downloaded DRAFT and isolated PASS candidate with observed Forgejo PASS");
  require(/read_release_state\)[\s\S]*?pre-mutation[\s\S]*?gh release upload "\$\{RELEASE_TAG\}" --clobber "\$\{candidate_metadata\[@\]\}"/, "candidate upload must recheck the observed remote draft state and mutate metadata only");
  require(/gh release edit "\$\{RELEASE_TAG\}" --draft=false[\s\S]*?read_release_state\)[\s\S]*?outcome/, "publication outcome must be determined from a post-publish remote-state observation");
  require(/restore_draft_or_fail\(\)[\s\S]*?read_release_state\)[\s\S]*?rollback[\s\S]*?\(cd release && sha256sum --check SHA256SUMS\)[\s\S]*?gh release upload "\$\{RELEASE_TAG\}" --clobber release\/release-status\.md release\/release-manifest\.json release\/SHA256SUMS/, "draft rollback must recheck state and restore only the verified DRAFT metadata");
  require(/candidate_stage_exit[\s\S]*?restore_draft_or_fail[\s\S]*?PASS candidate staging failed/, "partial PASS candidate staging must restore the DRAFT snapshot or fail without further mutation");

  const publicationHelper = "scripts/release_publication.mjs";
  if (!existsSync(resolve(root, publicationHelper))) {
    violations.push(
      `${publicationHelper}: behavioral publication policy helper is missing`,
    );
  } else {
    const helper = read(root, publicationHelper);
    if (
      !/releaseState === "published"[\s\S]*?published release artifacts are immutable/.test(
        helper,
      )
    ) {
      violations.push(
        `${publicationHelper}: published releases must fail closed as immutable`,
      );
    }
    if (!/publish && forgejoCiStatus !== "PASS"/.test(helper)) {
      violations.push(
        `${publicationHelper}: publish=true must require Forgejo canonical CI PASS`,
      );
    }
    if (!/eventName === "push" && publish/.test(helper)) {
      violations.push(
        `${publicationHelper}: tag-push publication must be rejected`,
      );
    }
    if (!/observedPrerelease !== expectedPrerelease/.test(helper)) {
      violations.push(
        `${publicationHelper}: existing draft classification mismatch must fail closed`,
      );
    }
    if (
      !/publish=true requires an existing validated draft release/.test(helper)
    ) {
      violations.push(
        `${publicationHelper}: publish=true must require an existing validated draft release`,
      );
    }
  }

  const transactionHelper = "scripts/release_publish_transaction.mjs";
  if (!existsSync(resolve(root, transactionHelper))) {
    violations.push(
      `${transactionHelper}: publication transaction state-machine helper is missing`,
    );
  } else {
    const helper = read(root, transactionHelper);
    if (
      !/return state\.draft \? "ROLLBACK_REQUIRED" : "SUCCESS"/.test(helper)
    ) {
      violations.push(
        `${transactionHelper}: post-publish outcome must be determined by observed remote state`,
      );
    }
    if (
      !/rollbackAction\(input\)[\s\S]*?preMutationAction\(input\)[\s\S]*?"RESTORE_DRAFT"[\s\S]*?"ABORT_ROLLBACK"/.test(
        helper,
      )
    ) {
      violations.push(
        `${transactionHelper}: rollback must require a second observed matching draft state`,
      );
    }
  }

  const executionHelper = "scripts/release_execution_mode.mjs";
  if (!existsSync(resolve(root, executionHelper))) {
    violations.push(`${executionHelper}: release build/publish mode helper is missing`);
  } else if (
    !/eventName === "push"[\s\S]*?eventName === "workflow_dispatch"/.test(
      read(root, executionHelper),
    )
  ) {
    violations.push(`${executionHelper}: must distinguish tag build and manual publication modes`);
  }

  const artifactHelper = "scripts/release_artifacts.mjs";
  if (!existsSync(resolve(root, artifactHelper))) {
    violations.push(`${artifactHelper}: release metadata helper is missing`);
  } else {
    const helper = read(root, artifactHelper);
    if (!/status === "PASS" && forgejoCiStatus !== "PASS"/.test(helper)) {
      violations.push(`${artifactHelper}: PASS publication metadata must require observed Forgejo canonical CI PASS`);
    }
    if (!/expected\.publicationStatus === "PASS"[\s\S]*?Forgejo canonical CI.*?PASS/.test(helper)) {
      violations.push(`${artifactHelper}: PASS snapshot validation must require Forgejo canonical CI PASS`);
    }
  }

  if (/^\s+branches:/m.test(workflow))
    violations.push(`${githubWorkflow}: branch push triggers are forbidden`);
  if (/^\s{2}(?:pull_request|schedule):/m.test(workflow))
    violations.push(`${githubWorkflow}: routine CI triggers are forbidden`);
  if (/runs-on:\s*macos-/i.test(workflow))
    violations.push(`${githubWorkflow}: Apple runners remain deferred`);
  if (/make\s+quality-check/.test(workflow))
    violations.push(
      `${githubWorkflow}: must not duplicate Forgejo routine quality-check`,
    );
  if (
    /\bgit\s+(?:tag|push)\b|\b(?:sed|perl)\b[^\n]*(?:VERSION|Cargo\.toml|package\.json)/i.test(
      workflow,
    )
  ) {
    violations.push(
      `${githubWorkflow}: release workflow may not mutate source or tags`,
    );
  }
  const writes = workflow.match(/^\s+contents:\s*write\s*$/gm) ?? [];
  if (writes.length !== 1)
    violations.push(
      `${githubWorkflow}: exactly one job must have contents: write`,
    );
  const checkoutCount = (workflow.match(/uses:\s*actions\/checkout@/g) ?? [])
    .length;
  const tagCheckoutCount = (
    workflow.match(
      /ref:\s*\$\{\{\s*format\(['"]refs\/tags\/\{0\}['"],\s*env\.RELEASE_TAG\)\s*\}\}/g,
    ) ?? []
  ).length;
  if (checkoutCount === 0 || checkoutCount !== tagCheckoutCount) {
    violations.push(
      `${githubWorkflow}: every checkout must use the exact release tag ref`,
    );
  }
  for (const match of workflow.matchAll(/^\s*uses:\s*(\S+)/gm)) {
    if (!/@[0-9a-f]{40}$/.test(match[1])) {
      violations.push(
        `${githubWorkflow}: action ${match[1]} must use a full commit revision`,
      );
    }
  }
  return violations;
}

function checkCargoPins(root, violations) {
  const workspace = parseToml(read(root, "Cargo.toml"));
  const manifests = [
    "Cargo.toml",
    ...workspace.workspace.members.map((item) => `${item}/Cargo.toml`),
  ];
  for (const name of manifests) {
    const manifest = parseToml(read(root, name));
    for (const section of [
      "dependencies",
      "dev-dependencies",
      "build-dependencies",
    ]) {
      for (const [dependency, value] of Object.entries(
        manifest[section] ?? {},
      )) {
        const requirement = dependencyRequirement(value);
        if (requirement !== undefined && !requirement.startsWith("=")) {
          violations.push(
            `${name}: ${section}.${dependency} must use an exact = version`,
          );
        }
        if (typeof value === "object" && value !== null && "git" in value) {
          violations.push(
            `${name}: ${section}.${dependency} may not use a git source`,
          );
        }
      }
    }
  }
}

const desktopCargoManifest = "apps/desktop/src-tauri/Cargo.toml";

export function cargoTomlEolPolicyViolations(root) {
  if (!existsSync(resolve(root, ".gitattributes"))) {
    return [".gitattributes: deterministic Cargo.toml LF policy is missing"];
  }
  const result = spawnSync(
    "git",
    ["check-attr", "text", "eol", "--", desktopCargoManifest],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    return ["could not inspect Git attributes for apps/desktop/src-tauri/Cargo.toml"];
  }
  const attributes = new Map(
    result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = /^.+: (text|eol): (.+)$/.exec(line);
        return match ? [match[1], match[2]] : ["", ""];
      }),
  );
  const violations = [];
  if (attributes.get("text") !== "set") {
    violations.push(
      "apps/desktop/src-tauri/Cargo.toml: Git text attribute must be set",
    );
  }
  if (attributes.get("eol") !== "lf") {
    violations.push(
      "apps/desktop/src-tauri/Cargo.toml: Git eol attribute must be lf",
    );
  }
  return violations;
}

export function sourcePolicyViolations(root) {
  const violations = [];
  let version;
  try {
    version = releaseVersion(root);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  for (const [name, kind] of versionFiles) {
    if (!existsSync(resolve(root, name))) {
      violations.push(`${name}: user-facing version source is missing`);
      continue;
    }
    const data =
      kind === "toml"
        ? parseToml(read(root, name))
        : JSON.parse(read(root, name));
    const declared = kind === "toml" ? data.package?.version : data.version;
    if (declared !== version)
      violations.push(`${name}: version ${String(declared)} != ${version}`);
  }
  const browserManifest = read(root, "apps/browser-extension/src/manifest.ts");
  if (
    !/import packageMetadata from "\.\.\/package\.json" with \{ type: "json" \}/.test(
      browserManifest,
    ) ||
    !/version_name:\s*releaseVersion/.test(browserManifest)
  ) {
    violations.push(
      "apps/browser-extension/src/manifest.ts: displayed version must come from package.json",
    );
  }
  const gatewayImageVersion = read(root, "apps/sync-gateway/Dockerfile").match(
    /^ARG NIAN_PASS_VERSION=(\S+)$/m,
  )?.[1];
  if (gatewayImageVersion !== version) {
    violations.push(
      `apps/sync-gateway/Dockerfile: default image version ${String(gatewayImageVersion)} != ${version}`,
    );
  }
  const lock = parseToml(read(root, "Cargo.lock"));
  for (const packageName of [
    "nian-pass-cli",
    "nian-pass-browser-host",
    "nian-pass-desktop",
    "nian-pass-sync-gateway",
  ]) {
    const locked = lock.package?.find(
      (item) => item.name === packageName,
    )?.version;
    if (locked !== version) {
      violations.push(
        `Cargo.lock: ${packageName} version ${String(locked)} != ${version}`,
      );
    }
  }

  const rootPackage = JSON.parse(read(root, "package.json"));
  const nodeVersion = read(root, ".node-version").trim();
  const mise = parseToml(read(root, ".mise.toml"));
  const rustToolchain = parseToml(read(root, "rust-toolchain.toml"));
  const workspace = parseToml(read(root, "Cargo.toml"));
  if (
    rootPackage.engines?.node !== nodeVersion ||
    mise.tools?.node !== nodeVersion
  ) {
    violations.push(
      "Node pins in package.json, .node-version, and .mise.toml must match",
    );
  }
  const rustVersion = mise.tools?.rust;
  if (
    rustToolchain.toolchain?.channel !== rustVersion ||
    workspace.workspace?.package?.["rust-version"] !== rustVersion
  ) {
    violations.push(
      "Rust pins in Cargo.toml, rust-toolchain.toml, and .mise.toml must match",
    );
  }
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(rootPackage.packageManager ?? "")) {
    violations.push("packageManager must pin one exact pnpm version");
  }

  for (const name of [
    "package.json",
    "apps/desktop/package.json",
    "apps/browser-extension/package.json",
  ]) {
    const manifest = JSON.parse(read(root, name));
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ]) {
      for (const [dependency, requirement] of Object.entries(
        manifest[section] ?? {},
      )) {
        if (!isExactVersion(requirement)) {
          violations.push(
            `${name}: ${section}.${dependency} must use an exact version`,
          );
        }
      }
    }
  }
  for (const lockfile of ["Cargo.lock", "pnpm-lock.yaml"]) {
    if (!existsSync(resolve(root, lockfile)))
      violations.push(`${lockfile}: release lockfile is missing`);
  }
  violations.push(...cargoTomlEolPolicyViolations(root));
  const androidBuild = read(
    root,
    "apps/desktop/src-tauri/gen/android/app/build.gradle.kts",
  );
  if (!androidBuild.includes('ndkVersion = "28.2.13676358"')) {
    violations.push("Android NDK must be pinned to 28.2.13676358");
  }
  const gradleWrapper = read(
    root,
    "apps/desktop/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties",
  );
  if (!/^distributionSha256Sum=[0-9a-f]{64}$/m.test(gradleWrapper)) {
    violations.push("Gradle distribution must have an exact SHA-256 pin");
  }
  const releaseProfile = workspace.profile?.release;
  if (
    releaseProfile?.["codegen-units"] !== 1 ||
    releaseProfile?.lto !== "thin" ||
    releaseProfile?.["overflow-checks"] !== true ||
    releaseProfile?.strip !== "symbols"
  ) {
    violations.push("Cargo release hardening profile is incomplete");
  }
  const denyPolicy = parseToml(read(root, "deny.toml"));
  if (denyPolicy.advisories?.yanked !== "deny") {
    violations.push("cargo-deny must reject yanked Rust packages");
  }

  checkCargoPins(root, violations);
  violations.push(...githubReleaseWorkflowViolations(root));
  for (const workflow of [
    ".forgejo/workflows/quality.yml",
    ".forgejo/workflows/openwiki-update.yml",
    ".github/workflows/release.yml",
  ]) {
    if (!existsSync(resolve(root, workflow))) continue;
    for (const match of read(root, workflow).matchAll(/^\s*uses:\s*(\S+)/gm)) {
      if (!/@[0-9a-f]{40}$/.test(match[1])) {
        violations.push(
          `${workflow}: action ${match[1]} must use a full commit revision`,
        );
      }
    }
    for (const match of read(root, workflow).matchAll(/^\s*image:\s*(\S+)/gm)) {
      if (!/@sha256:[0-9a-f]{64}$/.test(match[1])) {
        violations.push(
          `${workflow}: container ${match[1]} must use a sha256 digest`,
        );
      }
    }
  }
  for (const dockerfile of ["apps/sync-gateway/Dockerfile"]) {
    for (const match of read(root, dockerfile).matchAll(/^FROM\s+(\S+)/gm)) {
      if (!/@sha256:[0-9a-f]{64}$/.test(match[1])) {
        violations.push(
          `${dockerfile}: base image ${match[1]} must use a sha256 digest`,
        );
      }
    }
  }
  return violations;
}

export function tagViolation(root, tag) {
  const expected = `v${releaseVersion(root)}`;
  return tag === expected
    ? null
    : `release tag ${tag || "<missing>"} != ${expected}`;
}

function gitCommit(root, revision) {
  const result = spawnSync("git", ["rev-parse", "--verify", revision], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function tagIdentityViolation(root, tag) {
  const tagRevision = `refs/tags/${tag}^{commit}`;
  const tagCommit = gitCommit(root, tagRevision);
  if (!tagCommit)
    return `release tag refs/tags/${tag} does not exist or does not resolve to a commit`;
  const headCommit = gitCommit(root, "HEAD");
  if (!headCommit) return "could not resolve the release HEAD commit";
  return tagCommit === headCommit
    ? null
    : `release tag refs/tags/${tag} points to ${tagCommit}, not HEAD ${headCommit}`;
}

export function dirtyTreeViolation(root) {
  const result = spawnSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) return "could not inspect the Git working tree";
  const status = result.stdout.trim();
  return status === ""
    ? null
    : `release source tree contains uncommitted changes:\n${status}`;
}

export function releaseIdentityViolations(root, {
  tag = process.env.RELEASE_TAG ?? "",
  commit = process.env.RELEASE_COMMIT,
  version = process.env.RELEASE_VERSION,
} = {}) {
  const violations = [];
  const mismatch = tagViolation(root, tag);
  if (mismatch) {
    violations.push(mismatch);
  } else {
    const identity = tagIdentityViolation(root, tag);
    if (identity) violations.push(identity);
  }
  const head = gitCommit(root, "HEAD");
  if (commit && head !== commit) {
    violations.push(`release HEAD ${String(head)} != expected commit ${commit}`);
  }
  const actualVersion = releaseVersion(root);
  if (version && actualVersion !== version) {
    violations.push(`release VERSION ${actualVersion} != expected version ${version}`);
  }
  return violations;
}

export function postBuildSourceViolations(root, identity = {}) {
  const violations = releaseIdentityViolations(root, identity);
  const dirty = dirtyTreeViolation(root);
  if (dirty) violations.push(`post-build mutation rejected: ${dirty}`);
  return violations;
}

function main() {
  const modes = new Set(process.argv.slice(2));
  const violations = sourcePolicyViolations(repositoryRoot);
  const prebuild = modes.has("--prebuild");
  const postbuild = modes.has("--postbuild");
  if (prebuild && postbuild) {
    violations.push("release source check modes --prebuild and --postbuild are mutually exclusive");
  }
  if (modes.has("--clean") || prebuild) {
    const dirty = dirtyTreeViolation(repositoryRoot);
    if (dirty) violations.push(dirty);
  }
  if ((modes.has("--tag") || prebuild) && !postbuild) {
    violations.push(...releaseIdentityViolations(repositoryRoot));
  }
  if (postbuild) {
    violations.push(...postBuildSourceViolations(repositoryRoot));
  }
  if (violations.length > 0) {
    process.stderr.write(
      `Release source check failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("Release source check passed.\n");
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
