import { pathToFileURL } from "node:url";

const releaseVersionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

export function isReleaseVersion(version) {
  return typeof version === "string" && releaseVersionPattern.test(version);
}

export function releaseVersionKind(version) {
  if (!isReleaseVersion(version)) {
    throw new Error(`invalid release version ${String(version)}`);
  }
  return version.includes("-") ? "prerelease" : "final";
}

export function isPrereleaseVersion(version) {
  return releaseVersionKind(version) === "prerelease";
}

function main() {
  const version = process.argv[2];
  process.stdout.write(`${releaseVersionKind(version)}\n`);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Release version classification failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
