import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error(`GitHub release state resolution failed: ${message}`);
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) fail(`${name} must be a non-empty string`);
  return value;
}

function requiredBoolean(value, name) {
  if (typeof value !== "boolean") fail(`${name} must be a boolean`);
  return value;
}

function releasePages(value) {
  if (!Array.isArray(value)) fail("list-releases response must be an array or paginated array of arrays");
  if (value.every(Array.isArray)) return value.flat();
  if (value.some(Array.isArray)) fail("paginated list-releases response mixes arrays and release records");
  return value;
}

export function resolveGithubReleaseState(releases, {
  tag,
  commit,
  prerelease,
}) {
  requiredString(tag, "expected tag");
  requiredString(commit, "expected commit");
  requiredBoolean(prerelease, "expected prerelease");
  const records = releasePages(releases);
  for (const release of records) {
    if (typeof release !== "object" || release === null || Array.isArray(release)) {
      fail("release record must be an object");
    }
    requiredString(release.tag_name, "release.tag_name");
    requiredString(release.target_commitish, "release.target_commitish");
    requiredBoolean(release.draft, "release.draft");
    requiredBoolean(release.prerelease, "release.prerelease");
    if (!Number.isSafeInteger(release.id) || release.id <= 0) {
      fail("release.id must be a positive safe integer");
    }
  }
  const matches = records.filter((release) => release.tag_name === tag);
  if (matches.length === 0) return { state: "none", prerelease: null, id: null, targetCommitish: null };
  if (matches.length !== 1) fail(`tag ${tag} has ${matches.length} matching releases`);

  const release = matches[0];
  if (release.target_commitish !== commit) {
    fail(`tag ${tag} targets ${release.target_commitish}, not expected commit ${commit}`);
  }
  if (release.prerelease !== prerelease) {
    fail(`tag ${tag} prerelease=${release.prerelease}, not expected ${prerelease}`);
  }
  return {
    state: release.draft ? "draft" : "published",
    prerelease: release.prerelease,
    id: release.id,
    targetCommitish: release.target_commitish,
  };
}

function main() {
  const outputFormat = process.argv[2] ?? "json";
  if (outputFormat !== "json" && outputFormat !== "tsv") {
    fail("output format must be json or tsv");
  }
  const tag = process.env.RELEASE_TAG;
  const commit = process.env.RELEASE_COMMIT;
  const prerelease = process.env.RELEASE_IS_PRERELEASE;
  if (prerelease !== "true" && prerelease !== "false") {
    fail("RELEASE_IS_PRERELEASE must be true or false");
  }
  let releases;
  try {
    releases = JSON.parse(readFileSync(0, "utf8"));
  } catch (error) {
    fail(`could not parse list-releases JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const state = resolveGithubReleaseState(releases, {
    tag,
    commit,
    prerelease: prerelease === "true",
  });
  if (outputFormat === "tsv") {
    process.stdout.write(
      `${state.state}\t${state.prerelease ?? ""}\t${state.id ?? ""}\t${state.targetCommitish ?? ""}\n`,
    );
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
