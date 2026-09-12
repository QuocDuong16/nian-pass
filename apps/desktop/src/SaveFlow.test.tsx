import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import App from "./App";
import { DesktopCommandError, type DesktopApi } from "./lib/desktop";
import type {
  CloseRequestEvent,
  DesktopWindowLifecycle,
} from "./lib/window-lifecycle";
import { mutationApi, mutationSnapshot } from "./test/desktop-api";
import type { VaultSnapshotDto } from "./types/desktop";

afterEach(cleanup);

const cleanSnapshot: VaultSnapshotDto = { ...mutationSnapshot, dirty: false };

async function unlock(api: DesktopApi, lifecycle?: DesktopWindowLifecycle) {
  render(<App api={api} windowLifecycle={lifecycle ?? null} />);
  fireEvent.click(screen.getByRole("button", { name: "Open existing vault" }));
  await screen.findByText("fixture.kdbx");
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByRole("button", { name: "Save vault" });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

function lifecycleHarness() {
  let closeHandler: ((event: CloseRequestEvent) => Promise<void>) | null = null;
  const destroyApprovedWindow = vi.fn().mockResolvedValue(undefined);
  const lifecycle: DesktopWindowLifecycle = {
    onCloseRequested: vi
      .fn()
      .mockImplementation(
        (handler: (event: CloseRequestEvent) => Promise<void>) => {
          closeHandler = handler;
          return Promise.resolve(vi.fn());
        },
      ),
    destroyApprovedWindow,
  };
  const triggerClose = async (preventDefault = vi.fn()) => {
    if (closeHandler === null) throw new Error("close handler missing");
    await closeHandler({ preventDefault });
    return preventDefault;
  };
  return {
    lifecycle,
    destroyApprovedWindow,
    triggerClose,
    registered: () => closeHandler !== null,
  };
}

function enterReloadCredential(password = "demopass") {
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: password },
  });
}

test("clean disables Save while dirty Save uses retained session authority directly", async () => {
  const cleanApi = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(cleanSnapshot),
  });
  await unlock(cleanApi);
  expect(screen.getByRole("button", { name: "Save vault" })).toBeDisabled();
  cleanup();

  const dirtyApi = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
  });
  await unlock(dirtyApi);
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));
  await waitFor(() => {
    expect(dirtyApi.saveVault).toHaveBeenCalledOnce();
  });
  expect(dirtyApi.saveVault).toHaveBeenCalledWith();
  expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("dialog", { name: "Save changes" }),
  ).not.toBeInTheDocument();
});

test.each([
  "saving",
  "external_conflict",
  "reload_credential",
  "reloading",
] as const)(
  "native close remains blocked during the %s save flow",
  async (kind) => {
    const harness = lifecycleHarness();
    const closePolicy = vi.fn().mockResolvedValue({ policy: "allow" });
    const savePending = deferred<VaultSnapshotDto>();
    const reloadPending = deferred<VaultSnapshotDto>();
    const api = mutationApi({
      unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
      closePolicy,
      saveVault:
        kind === "saving"
          ? vi.fn().mockReturnValue(savePending.promise)
          : vi
              .fn()
              .mockRejectedValue(new DesktopCommandError("external_change")),
      reloadVault:
        kind === "reloading"
          ? vi.fn().mockReturnValue(reloadPending.promise)
          : vi.fn().mockResolvedValue(cleanSnapshot),
    });
    await unlock(api, harness.lifecycle);
    await waitFor(() => {
      expect(harness.registered()).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Save vault" }));

    if (kind === "external_conflict") {
      await screen.findByRole("dialog", {
        name: "The KDBX file changed outside Nian Pass",
      });
    }

    if (kind === "reload_credential" || kind === "reloading") {
      await screen.findByRole("dialog", {
        name: "The KDBX file changed outside Nian Pass",
      });
      fireEvent.click(
        screen.getByRole("button", {
          name: "Discard local changes and reload",
        }),
      );
    }

    if (kind === "reloading") {
      enterReloadCredential();
      fireEvent.click(
        screen.getByRole("button", {
          name: "Discard local changes and reload",
        }),
      );
    }

    const preventDefault = await harness.triggerClose();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(closePolicy).not.toHaveBeenCalled();
    expect(harness.destroyApprovedWindow).not.toHaveBeenCalled();

    if (kind === "saving") {
      await act(async () => {
        savePending.resolve(cleanSnapshot);
        await savePending.promise;
      });
    }
    if (kind === "reloading") {
      await act(async () => {
        reloadPending.resolve(cleanSnapshot);
        await reloadPending.promise;
      });
    }
  },
);

test("Save waits for Rust, disables mutation, then accepts only canonical clean state", async () => {
  const pending = deferred<VaultSnapshotDto>();
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    saveVault: vi.fn().mockReturnValue(pending.promise),
  });
  await unlock(api);
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));

  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(screen.queryByText(/^Saved$/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save vault" })).toHaveTextContent(
    "Saving…",
  );
  expect(screen.getByRole("button", { name: "Lock" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "+ New entry" })).toBeDisabled();

  await act(async () => {
    pending.resolve(cleanSnapshot);
    await pending.promise;
  });
  await waitFor(() => {
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });
  expect(screen.getByRole("button", { name: "Save vault" })).toBeDisabled();
  expect(screen.getAllByText("Saved").length).toBeGreaterThan(0);
});

test("save authentication failure requires reopening and keeps dirty state", async () => {
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    saveVault: vi
      .fn()
      .mockRejectedValue(new DesktopCommandError("save_authentication_failed")),
  });
  await unlock(api);
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));

  expect(
    await screen.findByText(
      /can no longer authenticate this vault for saving/i,
    ),
  ).toBeVisible();
  expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(api.lockVault).not.toHaveBeenCalled();
});

test("save uncertainty refreshes canonical state without showing a false success", async () => {
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    saveVault: vi
      .fn()
      .mockRejectedValue(new DesktopCommandError("save_uncertain")),
    getVaultSnapshot: vi.fn().mockResolvedValue(cleanSnapshot),
  });
  await unlock(api);
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));

  expect(
    await screen.findByText(/could not verify the final on-disk state/),
  ).toBeVisible();
  expect(api.getVaultSnapshot).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  expect(document.querySelector(".save-status")).toBeEmptyDOMElement();
  expect(screen.getByRole("button", { name: "Save vault" })).toBeDisabled();
  expect(api.lockVault).not.toHaveBeenCalled();
  expect(api.discardChangesAndLock).not.toHaveBeenCalled();
});

test.each([
  ["Lock", "Save changes and lock"],
  ["Close", "Save changes and close"],
] as const)(
  "save uncertainty refreshes clean state but never continues pending %s",
  async (intent, actionLabel) => {
    const harness = lifecycleHarness();
    const api = mutationApi({
      unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
      closePolicy: vi.fn().mockResolvedValue({ policy: "confirm_discard" }),
      saveVault: vi
        .fn()
        .mockRejectedValue(new DesktopCommandError("save_uncertain")),
      getVaultSnapshot: vi.fn().mockResolvedValue(cleanSnapshot),
    });
    await unlock(api, harness.lifecycle);

    if (intent === "Lock") {
      fireEvent.click(screen.getByRole("button", { name: "Lock" }));
    } else {
      await waitFor(() => {
        expect(harness.registered()).toBe(true);
      });
      await act(async () => {
        await harness.triggerClose();
      });
    }
    fireEvent.click(screen.getByRole("button", { name: actionLabel }));

    expect(
      await screen.findByText(/could not verify the final on-disk state/),
    ).toBeVisible();
    expect(api.getVaultSnapshot).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(document.querySelector(".save-status")).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Save vault" })).toBeDisabled();
    expect(api.lockVault).not.toHaveBeenCalled();
    expect(api.discardChangesAndLock).not.toHaveBeenCalled();
    expect(harness.destroyApprovedWindow).not.toHaveBeenCalled();
  },
);

test("external conflict keeps local dirty state and explicit Cancel does no discard", async () => {
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    saveVault: vi
      .fn()
      .mockRejectedValue(new DesktopCommandError("external_change")),
  });
  await unlock(api);
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));

  expect(
    await screen.findByRole("dialog", {
      name: "The KDBX file changed outside Nian Pass",
    }),
  ).toBeVisible();
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(screen.queryByText(/^Saved$/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(api.reloadVault).not.toHaveBeenCalled();
  expect(api.discardChangesAndLock).not.toHaveBeenCalled();
});

test("conflict reload succeeds cleanly while reload failure retains local dirty representation", async () => {
  const reloadVault = vi
    .fn()
    .mockRejectedValueOnce(new DesktopCommandError("reload_failed"))
    .mockResolvedValueOnce(cleanSnapshot);
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    saveVault: vi
      .fn()
      .mockRejectedValue(new DesktopCommandError("external_change")),
    reloadVault,
  });
  await unlock(api);
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Discard local changes and reload",
    }),
  );
  enterReloadCredential("wrong-current-password");
  fireEvent.click(
    screen.getByRole("button", { name: "Discard local changes and reload" }),
  );
  expect(await screen.findByText(/could not be reopened/)).toBeVisible();
  expect(screen.getByLabelText("Master password")).toHaveValue("");
  expect(screen.getByText("Unsaved changes")).toBeVisible();

  enterReloadCredential("current-password");
  fireEvent.click(
    screen.getByRole("button", { name: "Discard local changes and reload" }),
  );
  await waitFor(() => {
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });
  expect(reloadVault).toHaveBeenNthCalledWith(1, "wrong-current-password");
  expect(reloadVault).toHaveBeenNthCalledWith(2, "current-password");
});

test("dirty Lock saves before ordinary Lock and never locks on save failure", async () => {
  const saveVault = vi
    .fn()
    .mockRejectedValueOnce(new DesktopCommandError("save_failed"))
    .mockResolvedValueOnce(cleanSnapshot);
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    saveVault,
  });
  await unlock(api);
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Save changes and lock" }),
  );
  expect(
    await screen.findByText(/in-memory changes are still available/),
  ).toBeVisible();
  expect(api.lockVault).not.toHaveBeenCalled();
  expect(screen.getByText("Unsaved changes")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Try Save again" }));
  await waitFor(() => {
    expect(api.lockVault).toHaveBeenCalledOnce();
  });
  expect(api.discardChangesAndLock).not.toHaveBeenCalled();
  expect(
    await screen.findByRole("button", { name: "Open existing vault" }),
  ).toBeVisible();
});

test("external conflict never completes a pending Lock or close intent", async () => {
  const lockApi = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    saveVault: vi
      .fn()
      .mockRejectedValue(new DesktopCommandError("external_change")),
  });
  await unlock(lockApi);
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Save changes and lock" }),
  );
  await screen.findByRole("dialog", {
    name: "The KDBX file changed outside Nian Pass",
  });
  expect(lockApi.lockVault).not.toHaveBeenCalled();
  expect(lockApi.discardChangesAndLock).not.toHaveBeenCalled();
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  cleanup();

  const harness = lifecycleHarness();
  const closeApi = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    closePolicy: vi.fn().mockResolvedValue({ policy: "confirm_discard" }),
    saveVault: vi
      .fn()
      .mockRejectedValue(new DesktopCommandError("external_change")),
  });
  await unlock(closeApi, harness.lifecycle);
  await waitFor(() => {
    expect(harness.registered()).toBe(true);
  });
  await act(async () => {
    await harness.triggerClose();
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save changes and close" }),
  );
  await screen.findByRole("dialog", {
    name: "The KDBX file changed outside Nian Pass",
  });
  expect(closeApi.lockVault).not.toHaveBeenCalled();
  expect(harness.destroyApprovedWindow).not.toHaveBeenCalled();
  expect(screen.getByText("Unsaved changes")).toBeVisible();
});

test("dirty close saves before Lock and close, while failure leaves the window open", async () => {
  const harness = lifecycleHarness();
  const saveVault = vi
    .fn()
    .mockRejectedValueOnce(new DesktopCommandError("save_failed"))
    .mockResolvedValueOnce(cleanSnapshot);
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    closePolicy: vi.fn().mockResolvedValue({ policy: "confirm_discard" }),
    saveVault,
  });
  await unlock(api, harness.lifecycle);
  await waitFor(() => {
    expect(harness.registered()).toBe(true);
  });
  await act(async () => {
    await harness.triggerClose();
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save changes and close" }),
  );
  expect(
    await screen.findByText(/in-memory changes are still available/),
  ).toBeVisible();
  expect(api.lockVault).not.toHaveBeenCalled();
  expect(harness.destroyApprovedWindow).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Try Save again" }));
  await waitFor(() => {
    expect(harness.destroyApprovedWindow).toHaveBeenCalledOnce();
  });
  expect(api.lockVault).toHaveBeenCalledOnce();
  expect(api.discardChangesAndLock).not.toHaveBeenCalled();
});

test("a close request arriving while Save is pending is prevented deterministically", async () => {
  const harness = lifecycleHarness();
  const pending = deferred<VaultSnapshotDto>();
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    closePolicy: vi.fn().mockResolvedValue({ policy: "confirm_discard" }),
    saveVault: vi.fn().mockReturnValue(pending.promise),
  });
  await unlock(api, harness.lifecycle);
  await waitFor(() => {
    expect(harness.registered()).toBe(true);
  });
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));

  const preventDefault = vi.fn();
  await act(async () => {
    await harness.triggerClose(preventDefault);
  });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(harness.destroyApprovedWindow).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save vault" })).toHaveTextContent(
    "Saving…",
  );

  await act(async () => {
    pending.resolve(cleanSnapshot);
    await pending.promise;
  });
});
