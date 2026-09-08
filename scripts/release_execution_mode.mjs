import { pathToFileURL } from "node:url";

function booleanInput(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`publish request must be true or false, received ${String(value)}`);
}

/** True means build/attest/stage; false means publish an existing draft only. */
export function releaseBuildMode({ eventName, publishRequested }) {
  if (eventName === "push") return true;
  if (eventName === "workflow_dispatch") return !booleanInput(publishRequested);
  throw new Error(`release execution is forbidden for event ${String(eventName)}`);
}

function main() {
  process.stdout.write(
    `${releaseBuildMode({
      eventName: process.env.RELEASE_EVENT_NAME,
      publishRequested: process.env.PUBLISH_RELEASE,
    })}\n`,
  );
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Release execution mode failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
