import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { MobileCommandError } from "../../lib/mobile";
import { createMobileApi, mobileSnapshot } from "../../test/mobile-api";
import type { VaultSnapshotDto } from "../../types/desktop";
import { MobileVaultApp } from "./MobileVaultApp";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const dirtySnapshot: VaultSnapshotDto = { ...mobileSnapshot, dirty: true };

async function unlockDirty(overrides = {}) {
  const api = createMobileApi({
    unlockVault: vi.fn().mockResolvedValue(dirtySnapshot),
    ...overrides,
  });
  render(<MobileVaultApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "Open KDBX" }));
  await screen.findByText("fixture.kdbx");
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText("Unsaved changes");
  return api;
}

async function unlockClean(overrides = {}) {
  const api = createMobileApi(overrides);
  render(<MobileVaultApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "Open KDBX" }));
  await screen.findByText("fixture.kdbx");
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText("Synthetic account");
  return api;
}

test("clean Lock stays unlocked and disables actions until release failure settles", async () => {
  let rejectLock: ((reason?: unknown) => void) | undefined;
  const lockVault = vi.fn().mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectLock = reject;
      }),
  );
  await unlockClean({ lockVault });

  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  expect(screen.getByText("fixture.kdbx")).toBeVisible();
  expect(screen.getByRole("button", { name: "Lock" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save vault" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "New entry" })).toBeDisabled();

  await act(() => {
    rejectLock?.(new Error("private native release detail"));
    return Promise.resolve();
  });
  expect(await screen.findByText(/could not safely release/i)).toBeVisible();
  expect(screen.getByText("fixture.kdbx")).toBeVisible();
  expect(screen.getByRole("button", { name: "Lock" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "New entry" })).toBeEnabled();
});

test("Save password clears before deferred provider transaction resolves", async () => {
  let resolveSave: ((snapshot: VaultSnapshotDto) => void) | undefined;
  const saveVault = vi.fn().mockImplementation(
    () =>
      new Promise<VaultSnapshotDto>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const api = await unlockDirty({ saveVault });
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));
  const dialog = screen.getByRole("dialog");
  const password = within(dialog).getByLabelText("Master password");
  fireEvent.change(password, { target: { value: "save-only" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(password).toHaveValue("");
  expect(api.saveVault).toHaveBeenCalledWith("save-only");
  await act(() => {
    resolveSave?.(mobileSnapshot);
    return Promise.resolve();
  });
  expect(await screen.findByText("Saved")).toBeVisible();
});

test("external change preserves dirty state and offers verified reload only", async () => {
  const api = await unlockDirty({
    saveVault: vi
      .fn()
      .mockRejectedValue(new MobileCommandError("external_change")),
  });
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText(
      "Nian Pass refused to overwrite the external generation.",
    ),
  ).toBeVisible();
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(api.lockVault).not.toHaveBeenCalled();
});

test("save uncertainty never displays Saved or continues pending Lock", async () => {
  const api = await unlockDirty({
    saveVault: vi
      .fn()
      .mockRejectedValue(new MobileCommandError("save_uncertain")),
  });
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Save changes and lock" }),
  );
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Save state is uncertain")).toBeVisible();
  expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  expect(api.lockVault).not.toHaveBeenCalled();
});

test("dirty Lock exposes Cancel and explicit discard without Save", async () => {
  const api = await unlockDirty();
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  expect(
    screen.getByRole("button", { name: "Save changes and lock" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Discard changes and lock" }),
  );
  expect(
    await screen.findByRole("button", { name: "Open KDBX" }),
  ).toBeVisible();
  expect(api.discardChangesAndLock).toHaveBeenCalledOnce();
  expect(api.saveVault).not.toHaveBeenCalled();
});

test("discard-and-lock release failure keeps the dirty vault open and usable", async () => {
  const api = await unlockDirty({
    discardChangesAndLock: vi
      .fn()
      .mockRejectedValue(new Error("private native release detail")),
  });
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Discard changes and lock" }),
  );

  expect(
    await screen.findByText(
      "The dirty session remains open because discard-and-lock did not complete.",
    ),
  ).toBeVisible();
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(screen.getByText("fixture.kdbx")).toBeVisible();
  expect(screen.getByRole("button", { name: "Lock" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "New entry" })).toBeEnabled();
  expect(api.discardChangesAndLock).toHaveBeenCalledOnce();
  expect(api.saveVault).not.toHaveBeenCalled();
});

test("recovery_required is fixed, generic, and blocks automatic action", async () => {
  const api = await unlockDirty({
    saveVault: vi
      .fn()
      .mockRejectedValue(new MobileCommandError("recovery_required")),
  });
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText(
      /cannot safely continue until the source is reconciled/i,
    ),
  ).toBeVisible();
  expect(screen.queryByText(/content:\/\//i)).not.toBeInTheDocument();
  expect(api.lockVault).not.toHaveBeenCalled();
  expect(api.discardChangesAndLock).not.toHaveBeenCalled();
});

test("read-only provider keeps browse but disables editing and Save", async () => {
  const api = createMobileApi({
    selectVault: vi
      .fn()
      .mockResolvedValue({ fileName: "readonly.kdbx", writable: false }),
  });
  render(<MobileVaultApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "Open KDBX" }));
  await screen.findByText("readonly.kdbx");
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  expect(
    await screen.findByText(/editing and Save are disabled/i),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Save vault" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "New entry" })).toBeDisabled();
  expect(screen.getByText("Synthetic account")).toBeVisible();
});

test("verified Save-and-Lock continues only after a canonical clean snapshot", async () => {
  const api = await unlockDirty();
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Save changes and lock" }),
  );
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "save-and-lock" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByRole("button", { name: "Open KDBX" }),
  ).toBeVisible();
  expect(api.saveVault).toHaveBeenCalledWith("save-and-lock");
  expect(api.lockVault).toHaveBeenCalledOnce();
});

test("a clean Save with source-release failure stays clean and unlocked", async () => {
  const api = await unlockDirty({
    lockVault: vi.fn().mockRejectedValue(new Error("native release failed")),
  });
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Save changes and lock" }),
  );
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "save-and-lock" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/vault is saved/i)).toBeVisible();
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  expect(screen.getByText("fixture.kdbx")).toBeVisible();
  expect(screen.getByRole("button", { name: "Lock" })).toBeEnabled();
  expect(api.saveVault).toHaveBeenCalledOnce();
  expect(api.lockVault).toHaveBeenCalledOnce();
});

test("authentication and precommit failures retain the credential flow", async () => {
  const saveVault = vi
    .fn()
    .mockRejectedValueOnce(new MobileCommandError("save_authentication_failed"))
    .mockRejectedValueOnce(new MobileCommandError("save_failed"));
  await unlockDirty({ saveVault });
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "wrong" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /did not authenticate/i,
  );
  expect(screen.getByLabelText("Master password")).toHaveValue("");

  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "correct" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /failed before Nian Pass could prove/i,
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Unsaved changes")).toBeVisible();
});

test("dirty Save response is uncertain and can return to review", async () => {
  await unlockDirty({
    saveVault: vi.fn().mockResolvedValue(dirtySnapshot),
  });
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Save state is uncertain")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Review vault" }));
  expect(screen.getByText("Unsaved changes")).toBeVisible();
});

test("external conflict reload retries without destroying the local session", async () => {
  const reloadVault = vi
    .fn()
    .mockRejectedValueOnce(
      new MobileCommandError("reload_authentication_failed"),
    )
    .mockResolvedValueOnce(mobileSnapshot);
  const api = await unlockDirty({
    saveVault: vi
      .fn()
      .mockRejectedValue(new MobileCommandError("external_change")),
    reloadVault,
  });
  fireEvent.click(screen.getByRole("button", { name: "Save vault" }));
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/refused to overwrite/i);
  fireEvent.click(
    screen.getByRole("button", { name: "Discard local changes and reload" }),
  );
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "wrong" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /could not be authenticated/i,
  );
  expect(screen.getByText("Unsaved changes")).toBeVisible();

  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(await screen.findByText("fixture.kdbx")).toBeVisible();
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  expect(api.reloadVault).toHaveBeenCalledTimes(2);
});
