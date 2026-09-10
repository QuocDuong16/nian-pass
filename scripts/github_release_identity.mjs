import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error(`GitHub release identity validation failed: ${message}`);
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${name} must be a non-empty string`);
  }
  return value;
}

function requiredBoolean(value, name) {
  if (typeof value !== "boolean") fail(`${name} must be a boolean`);
  return value;
}

function requiredId(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${name} must be a positive safe integer`);
  }
  return value;
}

/** Validate a single, already-bound GitHub Release object by numeric ID. */
export function validateGithubReleaseIdentity(release, {
  id,
  tag,
  commit,
  prerelease,
  draft,
  requirePublishedAt = false,
}) {
  if (typeof release !== "object" || release === null || Array.isArray(release)) {
    fail("release response must be an object");
  }
  requiredId(id, "expected release ID");
  requiredString(tag, "expected tag");
  requiredString(commit, "expected commit");
  requiredBoolean(prerelease, "expected prerelease");
  if (draft !== undefined) requiredBoolean(draft, "expected draft");

  const observedId = requiredId(release.id, "release.id");
  const observedTag = requiredString(release.tag_name, "release.tag_name");
  const observedCommit = requiredString(release.target_commitish, "release.target_commitish");
  const observedDraft = requiredBoolean(release.draft, "release.draft");
  const observedPrerelease = requiredBoolean(release.prerelease, "release.prerelease");
  if (observedId !== id) fail(`release ID identity drift: expected ${id}, observed ${observedId}`);
  if (observedTag !== tag) fail(`release tag identity drift: expected ${tag}, observed ${observedTag}`);
  if (observedCommit !== commit) fail(`release commit identity drift: expected ${commit}, observed ${observedCommit}`);
  if (observedPrerelease !== prerelease) {
    fail(`release prerelease identity drift: expected ${prerelease}, observed ${observedPrerelease}`);
  }
  if (draft !== undefined && observedDraft !== draft) {
    fail(`release draft state drift: expected ${draft}, observed ${observedDraft}`);
  }
  if (requirePublishedAt && (typeof release.published_at !== "string" || release.published_at.length === 0)) {
    fail("release.published_at must be a non-empty string after publication");
  }
  return {
    draft: observedDraft,
    prerelease: observedPrerelease,
    id: observedId,
    tag: observedTag,
    targetCommitish: observedCommit,
  };
}

function parseExpectedBoolean(name, required = true) {
  const value = process.env[name];
  if (!required && (value === undefined || value === "")) return undefined;
  if (value !== "true" && value !== "false") fail(`${name} must be true or false`);
  return value === "true";
}

function main() {
  const outputFormat = process.argv[2] ?? "json";
  if (outputFormat !== "json" && outputFormat !== "tsv") fail("output format must be json or tsv");
  let release;
  try {
    release = JSON.parse(readFileSync(0, "utf8"));
  } catch (error) {
    fail(`could not parse release JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const state = validateGithubReleaseIdentity(release, {
    id: Number(process.env.RELEASE_ID),
    tag: process.env.RELEASE_TAG,
    commit: process.env.RELEASE_COMMIT,
    prerelease: parseExpectedBoolean("RELEASE_IS_PRERELEASE"),
    draft: parseExpectedBoolean("EXPECTED_RELEASE_DRAFT", false),
    requirePublishedAt: parseExpectedBoolean("REQUIRE_PUBLISHED_AT", false) ?? false,
  });
  if (outputFormat === "tsv") {
    process.stdout.write(`${state.draft}\t${state.prerelease}\t${state.id}\t${state.tag}\t${state.targetCommitish}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(state)}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
