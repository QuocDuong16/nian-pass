import assert from "node:assert/strict";
import { test } from "node:test";

import { publicationAction } from "../release_publication.mjs";

function action(
  releaseState,
  publishRequested,
  forgejoCiStatus,
  eventName = "workflow_dispatch",
) {
  return publicationAction({
    releaseState,
    publishRequested,
    forgejoCiStatus,
    eventName,
    releaseTag: "v0.1.0",
  });
}

test("missing and draft releases remain mutable staging material", () => {
  for (const forgejoCiStatus of ["NOT RUN", "PASS"]) {
    assert.equal(action("none", false, forgejoCiStatus), "CREATE_DRAFT");
    assert.equal(action("draft", false, forgejoCiStatus), "UPDATE_DRAFT");
  }
});

test("publication requires observed Forgejo PASS", () => {
  assert.equal(action("none", true, "PASS"), "CREATE_AND_PUBLISH");
  assert.equal(action("draft", true, "PASS"), "UPDATE_AND_PUBLISH");
  assert.throws(
    () => action("none", true, "NOT RUN"),
    /requires observed Forgejo/,
  );
  assert.throws(
    () => action("draft", true, "NOT RUN"),
    /requires observed Forgejo/,
  );
});

test("published releases are immutable for dry-run and publish requests", () => {
  for (const publishRequested of [false, true]) {
    for (const forgejoCiStatus of ["NOT RUN", "PASS"]) {
      assert.throws(
        () => action("published", publishRequested, forgejoCiStatus),
        /already published; published release artifacts are immutable/,
      );
    }
  }
});

test("tag pushes are draft-only", () => {
  assert.equal(action("none", false, "NOT RUN", "push"), "CREATE_DRAFT");
  assert.equal(action("draft", false, "PASS", "push"), "UPDATE_DRAFT");
  assert.throws(() => action("none", true, "PASS", "push"), /draft-only/);
});
