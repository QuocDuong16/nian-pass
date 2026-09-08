import { pathToFileURL } from "node:url";

function booleanInput(value, name) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`${name} must be true or false, received ${String(value)}`);
}

function observedRelease(draft, prerelease, expectedPrerelease) {
  return {
    draft: booleanInput(draft, "observed release draft state"),
    prerelease: booleanInput(prerelease, "observed release prerelease state"),
    expectedPrerelease: booleanInput(
      expectedPrerelease,
      "expected release prerelease state",
    ),
  };
}

export function preMutationAction(input) {
  let state;
  try {
    state = observedRelease(
      input.draft,
      input.prerelease,
      input.expectedPrerelease,
    );
  } catch {
    return "AMBIGUOUS";
  }
  if (state.prerelease !== state.expectedPrerelease) return "AMBIGUOUS";
  return state.draft ? "UPLOAD_CANDIDATE" : "REFUSE_PUBLISHED";
}

export function publishOutcome(input) {
  let state;
  try {
    state = observedRelease(
      input.draft,
      input.prerelease,
      input.expectedPrerelease,
    );
  } catch {
    return "AMBIGUOUS";
  }
  if (state.prerelease !== state.expectedPrerelease) return "AMBIGUOUS";
  return state.draft ? "ROLLBACK_REQUIRED" : "SUCCESS";
}

export function rollbackAction(input) {
  return preMutationAction(input) === "UPLOAD_CANDIDATE"
    ? "RESTORE_DRAFT"
    : "ABORT_ROLLBACK";
}

function main() {
  const command = process.argv[2];
  const input = {
    draft: process.env.OBSERVED_RELEASE_DRAFT,
    prerelease: process.env.OBSERVED_RELEASE_PRERELEASE,
    expectedPrerelease: process.env.EXPECTED_RELEASE_PRERELEASE,
  };
  let action;
  if (command === "pre-mutation") action = preMutationAction(input);
  else if (command === "outcome") action = publishOutcome(input);
  else if (command === "rollback") action = rollbackAction(input);
  else
    throw new Error(
      "usage: release_publish_transaction.mjs pre-mutation|outcome|rollback",
    );
  process.stdout.write(`${action}\n`);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Release publication transaction failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
