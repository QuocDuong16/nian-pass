import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { createMobileApi, mobileSnapshot } from "../../test/mobile-api";
import type {
  MobileApi,
  MobileSecurityResumeDto,
  MobileVaultSnapshotDto,
} from "../../types/mobile";
import { MobileVaultApp } from "./MobileVaultApp";
import {
  DEFAULT_MOBILE_AUTO_LOCK_MS,
  mobileElapsedExpired,
} from "./useMobileIdleSecurity";

const dirtySnapshot: MobileVaultSnapshotDto = {
  ...mobileSnapshot,
  dirty: true,
};

interface SecurityController {
  api: MobileApi;
  hidden: ReturnType<typeof vi.spyOn>;
  background: (screenState?: MobileSecurityResumeDto["screenState"]) => void;
  loseFocus: () => void;
  resume: () => void;
  setOperationPending: (pending: boolean) => void;
  setVaultState: (state: MobileSecurityResumeDto["vaultState"]) => void;
}

function securityController(
  snapshot: MobileVaultSnapshotDto = mobileSnapshot,
  overrides: Partial<MobileApi> = {},
): SecurityController {
  let hiddenValue = false;
  let foreground = true;
  let generation = 1;
  let screenState: MobileSecurityResumeDto["screenState"] = "active";
  let vaultState: MobileSecurityResumeDto["vaultState"] = snapshot.dirty
    ? "dirty"
    : "clean";
  let operationPending = false;
  const hidden = vi
    .spyOn(document, "hidden", "get")
    .mockImplementation(() => hiddenValue);
  const lockVault = vi.fn(() => {
    vaultState = "locked";
    return Promise.resolve();
  });
  const unlockVault = vi.fn(() => {
    vaultState = snapshot.dirty ? "dirty" : "clean";
    return Promise.resolve(snapshot);
  });
  const api = createMobileApi({
    unlockVault,
    lockVault,
    securityResume: vi.fn(() =>
      Promise.resolve({
        foreground,
        elapsedRealtimeMs: performance.now(),
        generation,
        screenState,
        curtainVisible: true,
        vaultState,
        operationPending,
      }),
    ),
    acknowledgeSafeUi: vi.fn().mockResolvedValue({ acknowledged: true }),
    ...overrides,
  });
  return {
    api,
    hidden,
    background: (nextScreenState = "active") => {
      hiddenValue = true;
      foreground = false;
      screenState = nextScreenState;
      generation += 1;
      fireEvent(document, new Event("visibilitychange"));
    },
    loseFocus: () => {
      generation += 1;
      fireEvent(window, new Event("blur"));
    },
    resume: () => {
      hiddenValue = false;
      foreground = true;
      screenState = "active";
      generation += 1;
      fireEvent(document, new Event("visibilitychange"));
      fireEvent(window, new Event("focus"));
    },
    setOperationPending: (pending) => {
      operationPending = pending;
    },
    setVaultState: (state) => {
      vaultState = state;
    },
  };
}

async function unlock(controller: SecurityController) {
  render(<MobileVaultApp api={controller.api} platform="android" />);
  fireEvent.click(screen.getByRole("button", { name: "Open KDBX" }));
  await screen.findByText("fixture.kdbx");
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByRole("button", { name: "Lock" });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("background immediately hides sensitive UI and clears unlock password", async () => {
  const controller = securityController();
  render(<MobileVaultApp api={controller.api} platform="android" />);
  fireEvent.click(screen.getByRole("button", { name: "Open KDBX" }));
  await screen.findByText("fixture.kdbx");
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "attempt-only" },
  });

  controller.background();

  expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
  expect(screen.queryByText("fixture.kdbx")).not.toBeInTheDocument();
});

test("pending acknowledgement cannot unshield after background", async () => {
  let resolveAcknowledgement:
    ((result: { acknowledged: boolean }) => void) | undefined;
  const acknowledgeSafeUi = vi.fn(
    () =>
      new Promise<{ acknowledged: boolean }>((resolve) => {
        resolveAcknowledgement = resolve;
      }),
  );
  const controller = securityController(mobileSnapshot, {
    acknowledgeSafeUi,
  });
  render(<MobileVaultApp api={controller.api} platform="android" />);
  await waitFor(() => {
    expect(acknowledgeSafeUi).toHaveBeenCalledOnce();
  });

  controller.background();
  await act(() => {
    resolveAcknowledgement?.({ acknowledged: true });
    return Promise.resolve();
  });

  expect(screen.getByText("Nian Pass locked")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Open KDBX" }),
  ).not.toBeInTheDocument();
});

test("focus invalidation ignores a stale pending acknowledgement", async () => {
  let resolveFirst: ((result: { acknowledged: boolean }) => void) | undefined;
  const acknowledgeSafeUi = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<{ acknowledged: boolean }>((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValue({ acknowledged: false });
  const controller = securityController(mobileSnapshot, {
    acknowledgeSafeUi,
  });
  render(<MobileVaultApp api={controller.api} platform="android" />);
  await waitFor(() => {
    expect(acknowledgeSafeUi).toHaveBeenCalledOnce();
  });

  controller.loseFocus();
  await act(() => {
    resolveFirst?.({ acknowledged: true });
    return Promise.resolve();
  });

  expect(screen.getByText("Nian Pass locked")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Open KDBX" }),
  ).not.toBeInTheDocument();
});

test("typing a locked-screen password does not create acknowledgement storms", async () => {
  const acknowledgeSafeUi = vi.fn().mockResolvedValue({ acknowledged: true });
  const controller = securityController(mobileSnapshot, {
    acknowledgeSafeUi,
  });
  render(<MobileVaultApp api={controller.api} platform="android" />);
  await waitFor(() => {
    expect(acknowledgeSafeUi).toHaveBeenCalledOnce();
  });
  fireEvent.click(screen.getByRole("button", { name: "Open KDBX" }));
  const password = await screen.findByLabelText("Master password");
  fireEvent.change(password, { target: { value: "a" } });
  fireEvent.change(password, { target: { value: "ab" } });
  fireEvent.change(password, { target: { value: "abc" } });

  expect(acknowledgeSafeUi).toHaveBeenCalledOnce();
});

test("clean unlocked background invokes the authoritative Lock", async () => {
  const controller = securityController();
  await unlock(controller);
  controller.background();
  await waitFor(() => {
    expect(controller.api.lockVault).toHaveBeenCalledOnce();
  });
  expect(screen.getByText("Nian Pass locked")).toBeVisible();
  controller.resume();
  expect(
    await screen.findByRole("button", { name: "Open KDBX" }),
  ).toBeVisible();
});

test("dirty background and screen-off never discard or autosave", async () => {
  const controller = securityController(dirtySnapshot);
  await unlock(controller);
  controller.background("screen_off");
  expect(await screen.findByText("Nian Pass locked")).toBeVisible();
  controller.resume();
  expect(
    await screen.findByText("Unsaved changes are still open"),
  ).toBeVisible();
  expect(controller.api.saveVault).not.toHaveBeenCalled();
  expect(controller.api.discardChangesAndLock).not.toHaveBeenCalled();
  expect(controller.api.lockVault).not.toHaveBeenCalled();
});

test("draft background retains plaintext only behind the shield until an explicit decision", async () => {
  const controller = securityController();
  await unlock(controller);
  fireEvent.click(screen.getByRole("button", { name: /Synthetic account/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit entry" }));
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "draft-secret" },
  });

  controller.background();
  expect(screen.queryByDisplayValue("draft-secret")).not.toBeVisible();
  controller.resume();
  expect(await screen.findByText("Unfinished edit")).toBeVisible();
  expect(controller.api.lockVault).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Continue editing" }));
  expect(screen.getByLabelText("Password")).toHaveValue("draft-secret");
});

test("discarding a local draft is explicit and then clean Lock proceeds", async () => {
  const controller = securityController();
  await unlock(controller);
  fireEvent.click(screen.getByRole("button", { name: /Synthetic account/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit entry" }));
  controller.background();
  controller.resume();
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard local draft" }),
  );
  expect(
    await screen.findByRole("button", { name: "Open KDBX" }),
  ).toBeVisible();
  expect(controller.api.lockVault).toHaveBeenCalledOnce();
});

test("failed lifecycle Lock remains shielded with a generic retry state", async () => {
  const controller = securityController(mobileSnapshot, {
    lockVault: vi.fn().mockRejectedValue(new Error("native source detail")),
  });
  await unlock(controller);
  controller.background();
  controller.resume();
  expect(await screen.findByText("Lock could not complete")).toBeVisible();
  expect(screen.queryByText("fixture.kdbx")).not.toBeVisible();
  expect(screen.getByRole("button", { name: "Retry Lock" })).toBeVisible();
});

test("stale unlock completion after background cannot expose the vault", async () => {
  let resolveUnlock: ((snapshot: MobileVaultSnapshotDto) => void) | undefined;
  const controller = securityController(mobileSnapshot, {
    unlockVault: vi.fn().mockImplementation(
      () =>
        new Promise<MobileVaultSnapshotDto>((resolve) => {
          resolveUnlock = resolve;
        }),
    ),
  });
  render(<MobileVaultApp api={controller.api} platform="android" />);
  fireEvent.click(screen.getByRole("button", { name: "Open KDBX" }));
  await screen.findByText("fixture.kdbx");
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  controller.background();
  await act(() => {
    resolveUnlock?.(mobileSnapshot);
    return Promise.resolve();
  });
  expect(screen.queryByText("Synthetic account")).not.toBeInTheDocument();
  await waitFor(() => {
    expect(controller.api.lockVault).toHaveBeenCalledOnce();
  });
});

test("pending operation keeps the resume shield until real state settles", async () => {
  const controller = securityController();
  controller.setOperationPending(true);
  await unlock(controller);
  controller.background();
  controller.resume();
  expect(await screen.findByText("Securing your vault")).toBeVisible();
  expect(controller.api.lockVault).not.toHaveBeenCalled();
  controller.setOperationPending(false);
  fireEvent(window, new Event("focus"));
  await waitFor(() => {
    expect(controller.api.lockVault).toHaveBeenCalledOnce();
  });
});

test("Save pending across background reconciles once without autosave or stale reveal", async () => {
  let resolveSave: ((snapshot: MobileVaultSnapshotDto) => void) | undefined;
  const saveVault = vi.fn().mockImplementation(
    () =>
      new Promise<MobileVaultSnapshotDto>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const controller = securityController(dirtySnapshot, { saveVault });
  await unlock(controller);
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "save-only" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  controller.setOperationPending(true);
  controller.background();
  expect(screen.getByText("Securing your vault")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  controller.setVaultState("clean");
  controller.setOperationPending(false);
  await act(() => {
    resolveSave?.(mobileSnapshot);
    return Promise.resolve();
  });
  fireEvent(window, new Event("focus"));
  await waitFor(() => {
    expect(controller.api.lockVault).toHaveBeenCalledOnce();
  });
  expect(saveVault).toHaveBeenCalledOnce();
  expect(screen.queryByText("Saved")).not.toBeInTheDocument();
});

test("a pre-operation Save credential dialog cannot bypass security attention", async () => {
  const controller = securityController(dirtySnapshot);
  await unlock(controller);
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "stale-save-password" },
  });
  expect(screen.getByRole("dialog")).toBeVisible();

  controller.background();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  controller.resume();

  expect(
    await screen.findByText("Unsaved changes are still open"),
  ).toBeVisible();
  expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
  expect(controller.api.saveVault).not.toHaveBeenCalled();
});

test("idle security attention closes a stale Save credential dialog", async () => {
  let monotonicNow = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => monotonicNow);
  const controller = securityController(dirtySnapshot);
  await unlock(controller);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.change(screen.getByLabelText("Mobile auto-lock timeout"), {
    target: { value: "60000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "expires-with-dialog" },
  });
  monotonicNow += 60_000;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });

  expect(screen.getByText("Unsaved changes are still open")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
  expect(controller.api.saveVault).not.toHaveBeenCalled();
});

test("security Save and lock opens a fresh credential prompt over hidden vault content", async () => {
  const controller = securityController(dirtySnapshot);
  await unlock(controller);
  controller.background();
  controller.resume();
  fireEvent.click(await screen.findByRole("button", { name: "Save and lock" }));

  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByLabelText("Master password")).toHaveValue("");
  expect(screen.getByText("fixture.kdbx")).not.toBeVisible();
  expect(
    screen.queryByText("Unsaved changes are still open"),
  ).not.toBeInTheDocument();
});

test("mutation result settling after background cannot dismiss newer dirty attention", async () => {
  let resolveMutation: ((snapshot: MobileVaultSnapshotDto) => void) | undefined;
  const updateEntry = vi.fn().mockImplementation(
    () =>
      new Promise<MobileVaultSnapshotDto>((resolve) => {
        resolveMutation = resolve;
      }),
  );
  const controller = securityController(mobileSnapshot, { updateEntry });
  await unlock(controller);
  fireEvent.click(screen.getByRole("button", { name: /Synthetic account/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit entry" }));
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "pending title" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));

  controller.setOperationPending(true);
  controller.background();
  controller.setVaultState("dirty");
  controller.setOperationPending(false);
  await act(() => {
    resolveMutation?.(dirtySnapshot);
    return Promise.resolve();
  });
  controller.resume();
  expect(
    await screen.findByText("Unsaved changes are still open"),
  ).toBeVisible();
  expect(controller.api.discardChangesAndLock).not.toHaveBeenCalled();
  expect(controller.api.lockVault).not.toHaveBeenCalled();
});

test("default timeout is five minutes and expiry uses monotonic elapsed time", () => {
  expect(DEFAULT_MOBILE_AUTO_LOCK_MS).toBe(300_000);
  expect(mobileElapsedExpired(10, 300_009, 300_000)).toBe(false);
  expect(mobileElapsedExpired(10, 300_010, 300_000)).toBe(true);
  expect(mobileElapsedExpired(10, Number.MAX_SAFE_INTEGER, null)).toBe(false);
});

test("foreground inactivity locks clean vault with fake timers", async () => {
  let monotonicNow = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => monotonicNow);
  const controller = securityController();
  await unlock(controller);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.change(screen.getByLabelText("Mobile auto-lock timeout"), {
    target: { value: "60000" },
  });
  monotonicNow += 60_000;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(controller.api.lockVault).toHaveBeenCalledOnce();
});

test("dirty idle requires attention without automatic data loss", async () => {
  let monotonicNow = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => monotonicNow);
  const controller = securityController(dirtySnapshot);
  await unlock(controller);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.change(screen.getByLabelText("Mobile auto-lock timeout"), {
    target: { value: "60000" },
  });
  monotonicNow += 60_000;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(screen.getByText("Unsaved changes are still open")).toBeVisible();
  expect(controller.api.saveVault).not.toHaveBeenCalled();
  expect(controller.api.discardChangesAndLock).not.toHaveBeenCalled();
});

test("frontend draft idle enters attention without discarding the draft", async () => {
  let monotonicNow = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => monotonicNow);
  const controller = securityController();
  await unlock(controller);
  fireEvent.click(screen.getByRole("button", { name: /Synthetic account/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit entry" }));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.change(screen.getByLabelText("Mobile auto-lock timeout"), {
    target: { value: "60000" },
  });
  monotonicNow += 60_000;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });

  expect(screen.getByText("Unfinished edit")).toBeVisible();
  expect(controller.api.lockVault).not.toHaveBeenCalled();
  expect(controller.api.discardChangesAndLock).not.toHaveBeenCalled();
});

test("Continue editing resets foreground activity deadline", async () => {
  let monotonicNow = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => monotonicNow);
  const controller = securityController(dirtySnapshot);
  await unlock(controller);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.change(screen.getByLabelText("Mobile auto-lock timeout"), {
    target: { value: "60000" },
  });
  monotonicNow += 60_000;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue editing" }));
  monotonicNow += 59_999;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(59_999);
  });
  expect(
    screen.queryByText("Unsaved changes are still open"),
  ).not.toBeInTheDocument();
  monotonicNow += 1;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByText("Unsaved changes are still open")).toBeVisible();
});

test("15 minute timeout survives Lock, source selection, and re-unlock in one app process", async () => {
  const controller = securityController();
  await unlock(controller);
  fireEvent.change(screen.getByLabelText("Mobile auto-lock timeout"), {
    target: { value: "900000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  await screen.findByRole("button", { name: "Open KDBX" });

  fireEvent.click(screen.getByRole("button", { name: "Open KDBX" }));
  fireEvent.change(await screen.findByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

  expect(await screen.findByLabelText("Mobile auto-lock timeout")).toHaveValue(
    "900000",
  );
});

test("Never survives Lock and re-unlock, but a new app root restores 5 minutes", async () => {
  const first = securityController();
  await unlock(first);
  const timeout = screen.getByLabelText("Mobile auto-lock timeout");
  fireEvent.change(timeout, { target: { value: "never" } });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60 * 60_000);
  });
  expect(first.api.lockVault).not.toHaveBeenCalled();
  vi.useRealTimers();
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  await screen.findByRole("button", { name: "Open KDBX" });
  fireEvent.click(screen.getByRole("button", { name: "Open KDBX" }));
  fireEvent.change(await screen.findByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  expect(await screen.findByLabelText("Mobile auto-lock timeout")).toHaveValue(
    "never",
  );

  first.background();
  await waitFor(() => {
    expect(first.api.lockVault).toHaveBeenCalledTimes(2);
  });

  cleanup();
  const second = securityController();
  await unlock(second);
  expect(screen.getByLabelText("Mobile auto-lock timeout")).toHaveValue(
    String(DEFAULT_MOBILE_AUTO_LOCK_MS),
  );
});
