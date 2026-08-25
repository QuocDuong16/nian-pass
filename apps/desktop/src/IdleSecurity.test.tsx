import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import App from "./App";
import { DEFAULT_AUTO_LOCK_MS } from "./features/vault/useIdleSecurity";
import { DesktopCommandError, type DesktopApi } from "./lib/desktop";
import type { DesktopWindowLifecycle } from "./lib/window-lifecycle";
import { mutationApi, mutationSnapshot } from "./test/desktop-api";
import type { VaultSnapshotDto } from "./types/desktop";

const cleanSnapshot: VaultSnapshotDto = { ...mutationSnapshot, dirty: false };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-25T00:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function lifecycleHarness() {
  let focusHandler: ((focused: boolean) => void) | null = null;
  const lifecycle: DesktopWindowLifecycle = {
    onCloseRequested: () => Promise.resolve(vi.fn()),
    onFocusChanged: (handler: (focused: boolean) => void) => {
      focusHandler = handler;
      return Promise.resolve(vi.fn());
    },
    requestClose: vi.fn().mockResolvedValue(undefined),
  };
  return {
    lifecycle,
    focus: async (focused: boolean) => {
      await act(async () => {
        focusHandler?.(focused);
        await Promise.resolve();
      });
    },
  };
}

async function unlock(
  api: DesktopApi,
  lifecycle: DesktopWindowLifecycle | null = null,
) {
  render(<App api={api} windowLifecycle={lifecycle} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose KDBX file" }));
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole("button", { name: "Lock" })).toBeVisible();
}

async function expire() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_LOCK_MS);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

test("clean inactivity locks exactly once and activity resets the deadline", async () => {
  const lockVault = vi.fn().mockResolvedValue({ clipboard: "not_owned" });
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(cleanSnapshot),
    lockVault,
  });
  await unlock(api);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEFAULT_AUTO_LOCK_MS - 1_000);
  });
  fireEvent.keyDown(window, { key: "Tab" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_001);
  });
  expect(lockVault).not.toHaveBeenCalled();

  await expire();
  expect(lockVault).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("button", { name: "Choose KDBX file" }),
  ).toBeVisible();
});

test("Never disables inactivity Lock while preserving the manual control", async () => {
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(cleanSnapshot),
  });
  await unlock(api);
  fireEvent.change(screen.getByLabelText("Auto-lock timeout"), {
    target: { value: "never" },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
  });
  expect(api.lockVault).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Lock" })).toBeEnabled();
});

test("blur hides vault content, focus restores it, and elapsed background time is reconciled", async () => {
  const harness = lifecycleHarness();
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(cleanSnapshot),
  });
  await unlock(api, harness.lifecycle);
  await harness.focus(false);
  expect(screen.getByText("Content hidden")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Account A/ }),
  ).not.toBeInTheDocument();
  expect(api.lockVault).not.toHaveBeenCalled();

  await harness.focus(true);
  expect(screen.getByRole("button", { name: /Account A/ })).toBeVisible();
  await harness.focus(false);
  vi.setSystemTime(Date.now() + DEFAULT_AUTO_LOCK_MS + 1);
  await harness.focus(true);
  await flush();
  expect(api.lockVault).toHaveBeenCalledOnce();
});

test("blur clears reveal-only plaintext without clearing or locking the clipboard flow", async () => {
  const harness = lifecycleHarness();
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(cleanSnapshot),
  });
  await unlock(api, harness.lifecycle);
  fireEvent.click(screen.getByRole("button", { name: /Account A/ }));
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  await flush();
  expect(screen.getByText("old-password")).toBeVisible();

  await harness.focus(false);
  await harness.focus(true);
  expect(screen.queryByText("old-password")).not.toBeInTheDocument();
  expect(api.lockVault).not.toHaveBeenCalled();
  expect(api.discardChangesAndLock).not.toHaveBeenCalled();
});

test("dirty timeout shields data and offers only explicit Save, Discard, or Continue", async () => {
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
  });
  await unlock(api);
  fireEvent.click(screen.getByRole("button", { name: /Account A/ }));
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  await flush();
  expect(screen.getByText("old-password")).toBeVisible();
  await expire();

  expect(screen.getByText("Unsaved changes need attention")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Account A/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save and lock" })).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Discard changes and lock" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Continue editing" }),
  ).toBeEnabled();
  expect(api.lockVault).not.toHaveBeenCalled();
  expect(api.discardChangesAndLock).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Continue editing" }));
  expect(screen.getByRole("button", { name: /Account A/ })).toBeVisible();
  expect(screen.queryByText("old-password")).not.toBeInTheDocument();
  expect(api.lockVault).not.toHaveBeenCalled();
});

test("dirty idle Save-and-Lock saves first while failure and conflict never lock", async () => {
  const saveVault = vi
    .fn()
    .mockRejectedValueOnce(new DesktopCommandError("save_failed"))
    .mockRejectedValueOnce(new DesktopCommandError("external_change"))
    .mockResolvedValueOnce(cleanSnapshot);
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    saveVault,
  });
  await unlock(api);
  await expire();
  fireEvent.click(screen.getByRole("button", { name: "Save and lock" }));
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "first" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await flush();
  expect(
    screen.getByText(/in-memory changes are still available/),
  ).toBeVisible();
  expect(screen.getByLabelText("Master password")).toHaveValue("");
  expect(api.lockVault).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "second" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await flush();
  expect(
    screen.getByRole("dialog", {
      name: "The KDBX file changed outside Nian Pass",
    }),
  ).toBeVisible();
  expect(api.lockVault).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Save and lock" }));
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "third" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await flush();
  expect(api.lockVault).toHaveBeenCalledOnce();
  expect(api.discardChangesAndLock).not.toHaveBeenCalled();
});

test("dirty idle discard uses only explicit discard-lock", async () => {
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
  });
  await unlock(api);
  await expire();
  fireEvent.click(
    screen.getByRole("button", { name: "Discard changes and lock" }),
  );
  await flush();
  expect(api.discardChangesAndLock).toHaveBeenCalledOnce();
  expect(api.lockVault).not.toHaveBeenCalled();
});

test("backend UnsavedChanges fallback becomes dirty attention without retry or discard", async () => {
  const lockVault = vi
    .fn()
    .mockRejectedValue(new DesktopCommandError("unsaved_changes"));
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(cleanSnapshot),
    lockVault,
  });
  await unlock(api);
  await expire();
  await flush();
  expect(screen.getByText("Unsaved changes need attention")).toBeVisible();
  expect(lockVault).toHaveBeenCalledOnce();
  expect(api.discardChangesAndLock).not.toHaveBeenCalled();
});

test("local edit draft survives blur and timeout cannot silently lock it", async () => {
  const harness = lifecycleHarness();
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(cleanSnapshot),
  });
  await unlock(api, harness.lifecycle);
  fireEvent.click(screen.getByRole("button", { name: /Account A/ }));
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "draft-password" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Load notes for editing" }),
  );
  await flush();
  fireEvent.change(screen.getByLabelText("Notes"), {
    target: { value: "draft notes" },
  });

  await harness.focus(false);
  expect(screen.getByLabelText("Password")).not.toBeVisible();
  await harness.focus(true);
  expect(screen.getByLabelText("Password")).toHaveValue("draft-password");
  expect(screen.getByLabelText("Notes")).toHaveValue("draft notes");

  await expire();
  expect(screen.getByText("Unfinished edit")).toBeVisible();
  expect(api.lockVault).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Return to edit" }));
  expect(screen.getByLabelText("Password")).toHaveValue("draft-password");
  expect(screen.getByLabelText("Notes")).toHaveValue("draft notes");
});

test("explicitly discarding a clean local draft permits one ordinary Lock", async () => {
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(cleanSnapshot),
  });
  await unlock(api);
  fireEvent.click(screen.getByRole("button", { name: "New entry" }));
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "unfinished" },
  });
  await expire();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Discard unfinished edit and continue",
    }),
  );
  await flush();
  expect(api.lockVault).toHaveBeenCalledOnce();
  expect(api.createEntry).not.toHaveBeenCalled();
  expect(api.discardChangesAndLock).not.toHaveBeenCalled();
});

test("group-operation input also participates in local-draft protection", async () => {
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(cleanSnapshot),
  });
  await unlock(api);
  fireEvent.click(screen.getByRole("button", { name: "New group" }));
  fireEvent.change(screen.getByLabelText("Group name"), {
    target: { value: "unfinished group" },
  });
  await expire();
  expect(screen.getByText("Unfinished edit")).toBeVisible();
  expect(api.lockVault).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Return to edit" }));
  expect(screen.getByLabelText("Group name")).toHaveValue("unfinished group");
});

test("manual Lock and idle expiry share a single in-flight frontend request", async () => {
  const pending = deferred<{ clipboard: "not_owned" }>();
  const lockVault = vi.fn().mockReturnValue(pending.promise);
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(cleanSnapshot),
    lockVault,
  });
  await unlock(api);
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  await expire();
  expect(lockVault).toHaveBeenCalledOnce();
  await act(async () => {
    pending.resolve({ clipboard: "not_owned" });
    await pending.promise;
  });
});

test("successful explicit Save after an elapsed deadline restarts inactivity", async () => {
  const pending = deferred<VaultSnapshotDto>();
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    saveVault: vi.fn().mockReturnValue(pending.promise),
  });
  await unlock(api);
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await expire();
  expect(screen.getByText("Securing your vault")).toBeVisible();
  await act(async () => {
    pending.resolve(cleanSnapshot);
    await pending.promise;
  });
  expect(api.lockVault).not.toHaveBeenCalled();
  expect(screen.getByText("Account A")).toBeVisible();
});
