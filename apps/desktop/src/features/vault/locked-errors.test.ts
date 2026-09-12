import { expect, test } from "vitest";

import { DesktopCommandError } from "../../lib/desktop";
import { lockedErrorCode, lockedOperationMessage } from "./locked-errors";

test("locked operation messages keep special open failures actionable", () => {
  expect(lockedOperationMessage("unsupported_vault")).toBe(
    "This file is not a supported KDBX vault.",
  );
  expect(lockedOperationMessage("already_unlocked")).toBe(
    "Lock the current vault before opening another one.",
  );
});

test("locked operation errors preserve stable command codes and hide unknown errors", () => {
  expect(lockedErrorCode(new DesktopCommandError("unlock_failed"))).toBe(
    "unlock_failed",
  );
  expect(lockedErrorCode(new Error("synthetic detail"))).toBe("internal");
  expect(lockedOperationMessage("internal")).toBe(
    "Nian Pass could not complete that vault operation. Try again.",
  );
});
