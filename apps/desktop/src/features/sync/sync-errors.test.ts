import { describe, expect, test } from "vitest";

import { DesktopCommandError } from "../../lib/desktop";
import { syncErrorMessage } from "./sync-errors";

describe("sync error messages", () => {
  test.each([
    ["unsaved_changes", "Save before syncing."],
    ["sync_remote_changed", "remote vault changed"],
    ["sync_local_changed", "local vault changed"],
    ["sync_local_changed_during_recovery", "recovery was pending"],
    ["sync_recovery_required", "recovery required"],
    ["sync_state_unsupported", "must be reset explicitly"],
    ["sync_state_corrupt", "metadata is corrupt"],
    ["sync_unsupported_provider", "compatible conditional-write"],
    ["sync_unsafe_provider", "compatible conditional-write"],
    ["sync_credentials_required", "master password"],
    ["operation_in_progress", "already in progress"],
    ["sync_failed", "failed safely"],
  ] as const)("maps %s without exposing raw errors", (code, expected) => {
    expect(syncErrorMessage(new DesktopCommandError(code))).toContain(expected);
  });

  test("maps non-contract failures generically", () => {
    expect(syncErrorMessage(new Error("SECRET_PROVIDER_DETAIL"))).toBe(
      "Synchronization failed safely.",
    );
  });
});
