import assert from "node:assert/strict";
import { test } from "node:test";

import {
  preMutationAction,
  publishOutcome,
  rollbackAction,
} from "../release_publish_transaction.mjs";

const prereleaseDraft = {
  draft: true,
  prerelease: true,
  expectedPrerelease: true,
};

const prereleasePublished = {
  draft: false,
  prerelease: true,
  expectedPrerelease: true,
};

test("only an observed draft with matching classification may receive a PASS candidate", () => {
  assert.equal(preMutationAction(prereleaseDraft), "UPLOAD_CANDIDATE");
  assert.equal(preMutationAction(prereleasePublished), "REFUSE_PUBLISHED");
  assert.equal(
    preMutationAction({ ...prereleaseDraft, prerelease: false }),
    "AMBIGUOUS",
  );
  assert.equal(
    preMutationAction({ ...prereleaseDraft, draft: "unknown" }),
    "AMBIGUOUS",
  );
});

test("observed GitHub state, not publish command exit status, determines success", () => {
  for (const publishCommandExit of [0, 1]) {
    assert.equal(
      publishOutcome({ ...prereleasePublished, publishCommandExit }),
      "SUCCESS",
    );
  }
});

test("an observed matching draft requires rollback whether the publish command succeeded or failed", () => {
  for (const publishCommandExit of [0, 1]) {
    assert.equal(
      publishOutcome({ ...prereleaseDraft, publishCommandExit }),
      "ROLLBACK_REQUIRED",
    );
  }
});

test("unknown or mismatched post-publish observations fail closed without rollback", () => {
  assert.equal(
    publishOutcome({ ...prereleaseDraft, draft: "unknown" }),
    "AMBIGUOUS",
  );
  assert.equal(
    publishOutcome({ ...prereleaseDraft, prerelease: false }),
    "AMBIGUOUS",
  );
});

test("rollback is guarded by a second observed matching draft state", () => {
  assert.equal(rollbackAction(prereleaseDraft), "RESTORE_DRAFT");
  assert.equal(rollbackAction(prereleasePublished), "ABORT_ROLLBACK");
  assert.equal(
    rollbackAction({ ...prereleaseDraft, prerelease: false }),
    "ABORT_ROLLBACK",
  );
});
