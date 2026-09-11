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
import { DesktopCommandError } from "./lib/desktop";
import { mutationApi, mutationSnapshot } from "./test/desktop-api";
import type {
  CloseRequestEvent,
  DesktopWindowLifecycle,
} from "./lib/window-lifecycle";

afterEach(cleanup);

async function unlock() {
  fireEvent.click(screen.getByRole("button", { name: "Choose KDBX file" }));
  await screen.findByText("fixture.kdbx");
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByRole("button", { name: "Lock" });
}

test("Rust dirty snapshot drives indicator and explicit discard-lock confirmation", async () => {
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
  });
  render(<App api={api} />);
  await unlock();
  expect(screen.getByText("Unsaved changes")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Save changes");
  expect(api.lockVault).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Unsaved changes")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Discard changes and lock" }),
  );
  await waitFor(() => {
    expect(api.discardChangesAndLock).toHaveBeenCalledOnce();
  });
  expect(
    await screen.findByRole("button", { name: "Choose KDBX file" }),
  ).toBeVisible();
});

test("successful mutation shows dirty through navigation while no-op and error stay clean", async () => {
  const clean = { ...mutationSnapshot, dirty: false };
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(clean),
    updateEntry: vi
      .fn()
      .mockResolvedValueOnce(clean)
      .mockRejectedValueOnce(new Error("synthetic"))
      .mockResolvedValueOnce(mutationSnapshot),
  });
  render(<App api={api} />);
  await unlock();
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Account A/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit entry" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  await screen.findByRole("button", { name: "Edit entry" });
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "fails" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(await screen.findByText("Could not update this entry.")).toBeVisible();
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "succeeds" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(await screen.findByText("Unsaved changes")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Child/ }));
  expect(screen.getByText("Unsaved changes")).toBeVisible();
});

test("dirty window close is prevented until explicit discard then destroyed", async () => {
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
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    closePolicy: vi.fn().mockResolvedValue({ policy: "confirm_discard" }),
  });
  render(<App api={api} windowLifecycle={lifecycle} />);
  await unlock();
  await waitFor(() => {
    expect(closeHandler).not.toBeNull();
  });
  const preventDefault = vi.fn();
  await act(async () => {
    if (closeHandler === null) throw new Error("close handler missing");
    await closeHandler({ preventDefault });
  });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(screen.getByRole("dialog")).toHaveTextContent("closing Nian Pass");
  fireEvent.click(
    screen.getByRole("button", { name: "Discard changes and close" }),
  );
  await waitFor(() => {
    expect(destroyApprovedWindow).toHaveBeenCalledOnce();
  });
  expect(api.discardChangesAndLock).toHaveBeenCalledOnce();
});

test("clean and locked close requests are prevented then explicitly destroyed", async () => {
  let closeHandler: (event: CloseRequestEvent) => Promise<void> = () =>
    Promise.reject(new Error("close handler missing"));
  const lifecycle: DesktopWindowLifecycle = {
    onCloseRequested: vi
      .fn()
      .mockImplementation(
        (handler: (event: CloseRequestEvent) => Promise<void>) => {
          closeHandler = handler;
          return Promise.resolve(vi.fn());
        },
      ),
    destroyApprovedWindow: vi.fn().mockResolvedValue(undefined),
  };
  const cleanApi = mutationApi({
    unlockVault: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    closePolicy: vi.fn().mockResolvedValue({ policy: "allow" }),
  });
  const clean = render(<App api={cleanApi} windowLifecycle={lifecycle} />);
  await unlock();
  await waitFor(() => {
    expect(lifecycle.onCloseRequested).toHaveBeenCalledOnce();
  });
  const cleanPreventDefault = vi.fn();
  await act(async () => {
    await closeHandler({ preventDefault: cleanPreventDefault });
  });
  expect(cleanPreventDefault).toHaveBeenCalledOnce();
  expect(lifecycle.destroyApprovedWindow).toHaveBeenCalledOnce();
  clean.unmount();

  closeHandler = () => Promise.reject(new Error("close handler missing"));
  render(<App api={mutationApi()} windowLifecycle={lifecycle} />);
  await waitFor(() => {
    expect(lifecycle.onCloseRequested).toHaveBeenCalledTimes(2);
  });
  const lockedPreventDefault = vi.fn();
  await act(async () => {
    await closeHandler({ preventDefault: lockedPreventDefault });
  });
  expect(lockedPreventDefault).toHaveBeenCalledOnce();
  expect(lifecycle.destroyApprovedWindow).toHaveBeenCalledTimes(2);
});

test("close is prevented synchronously and duplicate policy checks are suppressed", async () => {
  let closeHandler: (event: CloseRequestEvent) => Promise<void> = () =>
    Promise.reject(new Error("close handler missing"));
  let resolvePolicy: (value: { policy: "allow" }) => void = () => {
    throw new Error("close policy resolver missing");
  };
  const closePolicy = vi.fn().mockImplementation(
    () =>
      new Promise<{ policy: "allow" }>((resolve) => {
        resolvePolicy = resolve;
      }),
  );
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
  const api = mutationApi({ closePolicy });
  render(<App api={api} windowLifecycle={lifecycle} />);
  await waitFor(() => {
    expect(lifecycle.onCloseRequested).toHaveBeenCalledOnce();
  });
  const firstPreventDefault = vi.fn();
  const first = closeHandler({ preventDefault: firstPreventDefault });
  expect(firstPreventDefault).toHaveBeenCalledOnce();
  const secondPreventDefault = vi.fn();
  await closeHandler({ preventDefault: secondPreventDefault });
  expect(secondPreventDefault).toHaveBeenCalledOnce();
  expect(closePolicy).toHaveBeenCalledOnce();
  await act(async () => {
    resolvePolicy({ policy: "allow" });
    await first;
  });
  expect(destroyApprovedWindow).toHaveBeenCalledOnce();
});

test("a local draft that appears during close-policy lookup prevents approved destruction", async () => {
  let closeHandler: (event: CloseRequestEvent) => Promise<void> = () =>
    Promise.reject(new Error("close handler missing"));
  let resolvePolicy: (value: { policy: "allow" }) => void = () => {
    throw new Error("close policy resolver missing");
  };
  const closePolicy = vi.fn().mockImplementation(
    () =>
      new Promise<{ policy: "allow" }>((resolve) => {
        resolvePolicy = resolve;
      }),
  );
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
  const api = mutationApi({
    unlockVault: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    closePolicy,
  });
  render(<App api={api} windowLifecycle={lifecycle} />);
  await unlock();

  const close = closeHandler({ preventDefault: vi.fn() });
  expect(closePolicy).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: /Account A/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit entry" }));
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "draft created during close" },
  });

  await act(async () => {
    await Promise.resolve();
    resolvePolicy({ policy: "allow" });
    await close;
  });
  expect(destroyApprovedWindow).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { name: "Unfinished edit" }),
  ).toBeVisible();
});

test("a blocked state that appears during close-policy lookup prevents approved destruction", async () => {
  let closeHandler: (event: CloseRequestEvent) => Promise<void> = () =>
    Promise.reject(new Error("close handler missing"));
  let resolvePolicy: (value: { policy: "allow" }) => void = () => {
    throw new Error("close policy resolver missing");
  };
  let resolveLock: (value: { clipboard: "not_owned" }) => void = () => {
    throw new Error("lock resolver missing");
  };
  const closePolicy = vi.fn().mockImplementation(
    () =>
      new Promise<{ policy: "allow" }>((resolve) => {
        resolvePolicy = resolve;
      }),
  );
  const lockVault = vi.fn().mockImplementation(
    () =>
      new Promise<{ clipboard: "not_owned" }>((resolve) => {
        resolveLock = resolve;
      }),
  );
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
  const api = mutationApi({
    unlockVault: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    closePolicy,
    lockVault,
  });
  render(<App api={api} windowLifecycle={lifecycle} />);
  await unlock();

  const close = closeHandler({ preventDefault: vi.fn() });
  expect(closePolicy).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  await waitFor(() => {
    expect(lockVault).toHaveBeenCalledOnce();
  });

  await act(async () => {
    resolvePolicy({ policy: "allow" });
    await close;
  });
  expect(destroyApprovedWindow).not.toHaveBeenCalled();
  act(() => {
    resolveLock({ clipboard: "not_owned" });
  });
});

test("local drafts prevent close before querying Rust policy", async () => {
  let closeHandler: (event: CloseRequestEvent) => Promise<void> = () =>
    Promise.reject(new Error("close handler missing"));
  const destroyApprovedWindow = vi.fn().mockResolvedValue(undefined);
  const closePolicy = vi.fn().mockResolvedValue({ policy: "allow" });
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
  const api = mutationApi({
    unlockVault: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    closePolicy,
  });
  render(<App api={api} windowLifecycle={lifecycle} />);
  await unlock();
  fireEvent.click(screen.getByRole("button", { name: /Account A/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit entry" }));
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "unfinished local title" },
  });
  await waitFor(() => {
    expect(lifecycle.onCloseRequested).toHaveBeenCalledOnce();
  });
  const preventDefault = vi.fn();
  await act(async () => {
    await closeHandler({ preventDefault });
  });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(closePolicy).not.toHaveBeenCalled();
  expect(destroyApprovedWindow).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { name: "Unfinished edit" }),
  ).toBeVisible();
});

test("post-discard close failure reports the already-locked state accurately", async () => {
  let closeHandler: ((event: CloseRequestEvent) => Promise<void>) | null = null;
  const lifecycle: DesktopWindowLifecycle = {
    onCloseRequested: vi
      .fn()
      .mockImplementation(
        (handler: (event: CloseRequestEvent) => Promise<void>) => {
          closeHandler = handler;
          return Promise.resolve(vi.fn());
        },
      ),
    destroyApprovedWindow: vi.fn().mockRejectedValue(new Error("synthetic")),
  };
  const api = mutationApi({
    unlockVault: vi.fn().mockResolvedValue(mutationSnapshot),
    closePolicy: vi.fn().mockResolvedValue({ policy: "confirm_discard" }),
  });
  render(<App api={api} windowLifecycle={lifecycle} />);
  await unlock();
  await waitFor(() => {
    expect(closeHandler).not.toBeNull();
  });
  await act(async () => {
    if (closeHandler === null) throw new Error("close handler missing");
    await closeHandler({ preventDefault: vi.fn() });
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Discard changes and close" }),
  );
  expect(
    await screen.findByText(
      "Vault locked, but Nian Pass could not close the window.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Choose KDBX file" }),
  ).toBeVisible();
  expect(
    screen.queryByText(/unlocked session remains active/i),
  ).not.toBeInTheDocument();
});

test("backend unsaved protection opens discard UI even from a stale clean snapshot", async () => {
  const discardChangesAndLock = vi
    .fn()
    .mockResolvedValue({ clipboard: "not_owned" });
  const api = mutationApi({
    unlockVault: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    lockVault: vi
      .fn()
      .mockRejectedValue(new DesktopCommandError("unsaved_changes")),
    discardChangesAndLock,
  });
  render(<App api={api} />);
  await unlock();
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("Save changes");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  const discard = screen.getByRole("button", {
    name: "Discard changes and lock",
  });
  expect(discard).toBeEnabled();
  expect(api.lockVault).toHaveBeenCalledOnce();

  fireEvent.click(discard);
  await waitFor(() => {
    expect(discardChangesAndLock).toHaveBeenCalledOnce();
  });
  expect(
    await screen.findByRole("button", { name: "Choose KDBX file" }),
  ).toBeVisible();
});

test("backend unsaved discard Cancel restores a usable stale-clean unlocked UI", async () => {
  const api = mutationApi({
    unlockVault: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    lockVault: vi
      .fn()
      .mockRejectedValue(new DesktopCommandError("unsaved_changes")),
  });
  render(<App api={api} />);
  await unlock();
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  await screen.findByRole("dialog");

  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect(cancel).toBeEnabled();
  fireEvent.click(cancel);

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Lock" })).toBeEnabled();
  expect(api.discardChangesAndLock).not.toHaveBeenCalled();
});

test("close-policy failure prevents close and delayed registration is unlistened", async () => {
  let handler: ((event: CloseRequestEvent) => Promise<void>) | null = null;
  let resolveListener: ((stop: () => void) => void) | null = null;
  const stop = vi.fn();
  const lifecycle: DesktopWindowLifecycle = {
    onCloseRequested: vi
      .fn()
      .mockImplementation(
        (next: (event: CloseRequestEvent) => Promise<void>) => {
          handler = next;
          return new Promise<() => void>((resolve) => {
            resolveListener = resolve;
          });
        },
      ),
    destroyApprovedWindow: vi.fn().mockResolvedValue(undefined),
  };
  const api = mutationApi({
    closePolicy: vi.fn().mockRejectedValue(new Error("synthetic")),
  });
  const view = render(<App api={api} windowLifecycle={lifecycle} />);
  await waitFor(() => {
    expect(handler).not.toBeNull();
  });
  const preventDefault = vi.fn();
  await act(async () => {
    if (handler === null) throw new Error("close handler missing");
    await handler({ preventDefault });
  });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(
    screen.getByText("Nian Pass could not verify whether it is safe to close."),
  ).toBeVisible();

  view.unmount();
  await act(async () => {
    if (resolveListener === null) throw new Error("listener resolver missing");
    resolveListener(stop);
    await Promise.resolve();
  });
  expect(stop).toHaveBeenCalledOnce();
});
