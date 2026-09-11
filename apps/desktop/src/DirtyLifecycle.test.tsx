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

test("dirty window close is prevented until explicit discard then requested again", async () => {
  let closeHandler: ((event: CloseRequestEvent) => Promise<void>) | null = null;
  const requestClose = vi.fn().mockResolvedValue(undefined);
  const lifecycle: DesktopWindowLifecycle = {
    onCloseRequested: vi
      .fn()
      .mockImplementation(
        (handler: (event: CloseRequestEvent) => Promise<void>) => {
          closeHandler = handler;
          return Promise.resolve(vi.fn());
        },
      ),
    requestClose,
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
    expect(requestClose).toHaveBeenCalledOnce();
  });
  expect(api.discardChangesAndLock).toHaveBeenCalledOnce();
});

test("clean and locked window close requests remain unprevented", async () => {
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
    requestClose: vi.fn().mockResolvedValue(undefined),
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
    expect(closeHandler).not.toBeNull();
  });
  const cleanPreventDefault = vi.fn();
  await act(async () => {
    if (closeHandler === null) throw new Error("close handler missing");
    await closeHandler({ preventDefault: cleanPreventDefault });
  });
  expect(cleanPreventDefault).not.toHaveBeenCalled();
  clean.unmount();

  closeHandler = null;
  render(<App api={mutationApi()} windowLifecycle={lifecycle} />);
  await waitFor(() => {
    expect(closeHandler).not.toBeNull();
  });
  const lockedPreventDefault = vi.fn();
  await act(async () => {
    if (closeHandler === null) throw new Error("close handler missing");
    await closeHandler({ preventDefault: lockedPreventDefault });
  });
  expect(lockedPreventDefault).not.toHaveBeenCalled();
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
    requestClose: vi.fn().mockRejectedValue(new Error("synthetic")),
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
    requestClose: vi.fn().mockResolvedValue(undefined),
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
