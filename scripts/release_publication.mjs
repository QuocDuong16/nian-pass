import { pathToFileURL } from "node:url";

const releaseStates = new Set(["none", "draft", "published"]);
const forgejoStatuses = new Set(["PASS", "NOT RUN"]);
const releaseKinds = new Set(["prerelease", "final"]);

function booleanInput(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(
    `publish request must be true or false, received ${String(value)}`,
  );
}

export function publicationAction({
  releaseState,
  existingPrerelease,
  releaseKind,
  publishRequested,
  forgejoCiStatus,
  eventName,
  releaseTag,
}) {
  if (!releaseStates.has(releaseState)) {
    throw new Error(`invalid existing release state ${String(releaseState)}`);
  }
  if (!forgejoStatuses.has(forgejoCiStatus)) {
    throw new Error(`invalid Forgejo CI status ${String(forgejoCiStatus)}`);
  }
  if (!releaseKinds.has(releaseKind)) {
    throw new Error(`invalid release kind ${String(releaseKind)}`);
  }
  if (eventName !== "push" && eventName !== "workflow_dispatch") {
    throw new Error(
      `release publication is forbidden for event ${String(eventName)}`,
    );
  }

  const publish = booleanInput(publishRequested);
  if (releaseState === "published") {
    throw new Error(
      `Release ${releaseTag} is already published; published release artifacts are immutable. Create a new version/tag instead.`,
    );
  }
  if (releaseState === "draft") {
    const observedPrerelease = booleanInput(existingPrerelease);
    const expectedPrerelease = releaseKind === "prerelease";
    if (observedPrerelease !== expectedPrerelease) {
      throw new Error(
        `Release ${releaseTag} draft prerelease state does not match source release kind ${releaseKind}`,
      );
    }
  }
  if (eventName === "push" && publish) {
    throw new Error("tag-push release runs are draft-only");
  }
  if (publish && forgejoCiStatus !== "PASS") {
    throw new Error("publish=true requires observed Forgejo canonical CI PASS");
  }

  if (releaseState === "none") {
    return publish ? "CREATE_AND_PUBLISH" : "CREATE_DRAFT";
  }
  return publish ? "UPDATE_AND_PUBLISH" : "UPDATE_DRAFT";
}

function main() {
  const action = publicationAction({
    releaseState: process.env.EXISTING_RELEASE_STATE,
    existingPrerelease: process.env.EXISTING_RELEASE_PRERELEASE,
    releaseKind: process.env.RELEASE_KIND,
    publishRequested: process.env.PUBLISH_RELEASE,
    forgejoCiStatus: process.env.FORGEJO_CI_STATUS,
    eventName: process.env.RELEASE_EVENT_NAME,
    releaseTag: process.env.RELEASE_TAG ?? "<unknown>",
  });
  process.stdout.write(`${action}\n`);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Release publication policy failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
