import assert from "node:assert/strict";
import { test } from "node:test";

import { publicationAction } from "../release_publication.mjs";

function action(
  releaseState,
  publishRequested,
  forgejoCiStatus,
  eventName = "workflow_dispatch",
  releaseKind = "prerelease",
  existingPrerelease = releaseState === "draft",
) {
  return publicationAction({
    releaseState,
    existingPrerelease,
    releaseKind,
    publishRequested,
    forgejoCiStatus,
    eventName,
    releaseTag: releaseKind === "prerelease" ? "v0.1.0-rc.9" : "v0.1.0",
  });
}

test("missing and draft releases remain mutable staging material", () => {
  for (const forgejoCiStatus of ["NOT RUN", "PASS"]) {
    assert.equal(action("none", false, forgejoCiStatus), "CREATE_DRAFT");
    assert.equal(action("draft", false, forgejoCiStatus), "UPDATE_DRAFT");
  }
});

test("publication requires observed Forgejo PASS", () => {
  assert.equal(action("draft", true, "PASS"), "UPDATE_AND_PUBLISH");
  assert.throws(
    () => action("none", true, "PASS"),
    /requires an existing validated draft release/,
  );
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

test("existing drafts must retain the source-derived release classification", () => {
  assert.equal(
    action("draft", false, "PASS", "workflow_dispatch", "prerelease", true),
    "UPDATE_DRAFT",
  );
  assert.equal(
    action("draft", false, "PASS", "workflow_dispatch", "final", false),
    "UPDATE_DRAFT",
  );
  assert.throws(
    () =>
      action("draft", false, "PASS", "workflow_dispatch", "prerelease", false),
    /does not match source release kind prerelease/,
  );
  assert.throws(
    () => action("draft", false, "PASS", "workflow_dispatch", "final", true),
    /does not match source release kind final/,
  );
});

test("RC and final publication actions preserve independent draft semantics", () => {
  assert.equal(
    action("none", false, "NOT RUN", "push", "prerelease"),
    "CREATE_DRAFT",
  );
  assert.equal(
    action("none", false, "NOT RUN", "push", "final"),
    "CREATE_DRAFT",
  );
  assert.equal(
    action("draft", true, "PASS", "workflow_dispatch", "final", false),
    "UPDATE_AND_PUBLISH",
  );
});
