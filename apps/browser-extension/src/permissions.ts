import type { BackgroundBrowserApi, RegisteredScript } from "./browser-api";
import { canonicalGrantedPatterns } from "./site-policy";

export const CONTENT_SCRIPT_ID = "nian-pass-site-content";
const reconciliationQueues = new WeakMap<BackgroundBrowserApi, Promise<void>>();

function expectedScript(matches: string[]): RegisteredScript {
  return {
    id: CONTENT_SCRIPT_ID,
    matches,
    js: ["content.js"],
    allFrames: false,
    runAt: "document_idle",
  };
}

function sameScript(
  actual: RegisteredScript,
  expected: RegisteredScript,
): boolean {
  return (
    actual.id === expected.id &&
    JSON.stringify(actual.matches ?? []) ===
      JSON.stringify(expected.matches ?? []) &&
    JSON.stringify(actual.js ?? []) === JSON.stringify(expected.js ?? []) &&
    actual.allFrames === expected.allFrames &&
    actual.runAt === expected.runAt
  );
}

async function reconcileNow(api: BackgroundBrowserApi): Promise<void> {
  const permissions = await api.getAllPermissions();
  const matches = canonicalGrantedPatterns(permissions.origins ?? []);
  const registered = await api.getRegisteredScripts(CONTENT_SCRIPT_ID);
  if (matches.length === 0) {
    if (registered.length > 0) await api.unregisterScripts(CONTENT_SCRIPT_ID);
    return;
  }
  const expected = expectedScript(matches);
  const [current] = registered;
  if (
    registered.length === 1 &&
    current !== undefined &&
    sameScript(current, expected)
  )
    return;
  if (registered.length > 0) await api.unregisterScripts(CONTENT_SCRIPT_ID);
  await api.registerScript(expected);
}

export function reconcileContentScript(
  api: BackgroundBrowserApi,
): Promise<void> {
  const previous = reconciliationQueues.get(api) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => reconcileNow(api));
  reconciliationQueues.set(api, current);
  return current.finally(() => {
    if (reconciliationQueues.get(api) === current) {
      reconciliationQueues.delete(api);
    }
  });
}
