import assert from "node:assert/strict";
import { test } from "node:test";

import { releaseBuildMode } from "../release_execution_mode.mjs";

test("tag pushes always use the full build and draft staging path", () => {
  assert.equal(releaseBuildMode({ eventName: "push", publishRequested: false }), true);
  assert.equal(releaseBuildMode({ eventName: "push", publishRequested: true }), true);
});

test("manual publish=false builds and stages while publish=true is publication-only", () => {
  assert.equal(
    releaseBuildMode({ eventName: "workflow_dispatch", publishRequested: false }),
    true,
  );
  assert.equal(
    releaseBuildMode({ eventName: "workflow_dispatch", publishRequested: true }),
    false,
  );
});

test("release execution mode fails closed for invalid trigger or publish input", () => {
  assert.throws(
    () => releaseBuildMode({ eventName: "pull_request", publishRequested: false }),
    /forbidden/,
  );
  assert.throws(
    () => releaseBuildMode({ eventName: "workflow_dispatch", publishRequested: "yes" }),
    /true or false/,
  );
});
