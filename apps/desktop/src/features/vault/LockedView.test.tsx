import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { DesktopCommandError } from "../../lib/desktop";
import { mutationApi, mutationSnapshot } from "../../test/desktop-api";
import { LockedView } from "./LockedView";

afterEach(cleanup);

function openCreate() {
  fireEvent.click(screen.getByRole("button", { name: "Create new vault" }));
  return screen.getByLabelText("Vault name").closest("form");
}

test("create vault validates progressively and submits trimmed metadata", async () => {
  const api = mutationApi();
  const onUnlocked = vi.fn();
  render(<LockedView api={api} onUnlocked={onUnlocked} />);
  const form = openCreate();
  if (form === null) throw new Error("create form missing");

  fireEvent.submit(form);
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a vault name");

  fireEvent.change(screen.getByLabelText("Vault name"), {
    target: { value: "  Personal  " },
  });
  fireEvent.submit(form);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Master password cannot be empty",
  );

  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "VeryStrongPassword1!" },
  });
  fireEvent.change(screen.getByLabelText("Confirm master password"), {
    target: { value: "different" },
  });
  fireEvent.submit(form);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Master password confirmation does not match",
  );

  fireEvent.change(screen.getByLabelText("Confirm master password"), {
    target: { value: "VeryStrongPassword1!" },
  });
  expect(screen.getByText("Password strength: Strong")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Create vault" }));

  await waitFor(() => {
    expect(api.createVault).toHaveBeenCalledWith(
      "Personal",
      "VeryStrongPassword1!",
    );
  });
  expect(onUnlocked).toHaveBeenCalledWith({
    ...mutationSnapshot,
    dirty: false,
  });
});

test.each([
  ["vault_already_exists", "A file already exists at that location"],
  ["vault_create_failed", "could not safely create the vault"],
  ["internal", "could not complete that vault operation"],
] as const)(
  "create vault maps %s without leaking details",
  async (code, message) => {
    const api = mutationApi({
      createVault: vi.fn().mockRejectedValue(new DesktopCommandError(code)),
    });
    render(<LockedView api={api} onUnlocked={vi.fn()} />);
    openCreate();

    fireEvent.change(screen.getByLabelText("Vault name"), {
      target: { value: "Personal" },
    });
    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "StrongPassword1!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm master password"), {
      target: { value: "StrongPassword1!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create vault" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Master password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm master password")).toHaveValue("");
  },
);

test("Escape cancels create and clears local credentials", () => {
  render(<LockedView api={mutationApi()} onUnlocked={vi.fn()} />);
  const form = openCreate();
  if (form === null) throw new Error("create form missing");
  fireEvent.change(screen.getByLabelText("Vault name"), {
    target: { value: "Temporary" },
  });
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "temporary-secret" },
  });

  fireEvent.keyDown(form, { key: "Escape" });
  expect(screen.getByRole("heading", { name: "Your vaults" })).toBeVisible();

  openCreate();
  expect(screen.getByLabelText("Vault name")).toHaveValue("");
  expect(screen.getByLabelText("Master password")).toHaveValue("");
});

test("keyfile-only unlock stays native and never requires a password", async () => {
  const unlockVaultWithKeyfile = vi
    .fn()
    .mockResolvedValue({ ...mutationSnapshot, dirty: false });
  const api = mutationApi({ unlockVaultWithKeyfile });
  const onUnlocked = vi.fn();
  render(<LockedView api={api} onUnlocked={onUnlocked} />);

  fireEvent.click(screen.getByRole("button", { name: "Open existing vault" }));
  expect(await screen.findByText("fixture.kdbx")).toBeVisible();
  const unlock = screen.getByRole("button", { name: "Unlock" });
  expect(unlock).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "Choose key file" }));
  expect(await screen.findByText("fixture.keyx")).toBeVisible();
  expect(unlock).toBeEnabled();
  fireEvent.click(unlock);

  await waitFor(() => {
    expect(unlockVaultWithKeyfile).toHaveBeenCalledWith(null);
    expect(onUnlocked).toHaveBeenCalledWith({
      ...mutationSnapshot,
      dirty: false,
    });
  });
  expect(api.unlockVault).not.toHaveBeenCalled();
});

test("password plus keyfile uses the composite unlock path and retry retains the keyfile", async () => {
  const unlockVaultWithKeyfile = vi
    .fn()
    .mockRejectedValueOnce(new DesktopCommandError("unlock_failed"))
    .mockResolvedValueOnce({ ...mutationSnapshot, dirty: false });
  const api = mutationApi({ unlockVaultWithKeyfile });
  render(<LockedView api={api} onUnlocked={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "Open existing vault" }));
  await screen.findByText("fixture.kdbx");
  fireEvent.click(screen.getByRole("button", { name: "Choose key file" }));
  await screen.findByText("fixture.keyx");
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "wrong-public-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not unlock this vault",
    );
  });
  expect(screen.getByLabelText("Master password")).toHaveValue("");
  expect(screen.getByText("fixture.keyx")).toBeVisible();

  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "public-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await waitFor(() => {
    expect(unlockVaultWithKeyfile).toHaveBeenNthCalledWith(
      2,
      "public-password",
    );
  });
});

test("removing a selected keyfile clears native state and restores credential validation", async () => {
  const clearKeyfile = vi.fn().mockResolvedValue(undefined);
  const api = mutationApi({ clearKeyfile });
  render(<LockedView api={api} onUnlocked={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "Open existing vault" }));
  await screen.findByText("fixture.kdbx");
  fireEvent.click(screen.getByRole("button", { name: "Choose key file" }));
  await screen.findByText("fixture.keyx");
  expect(screen.getByRole("button", { name: "Unlock" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => {
    expect(clearKeyfile).toHaveBeenCalledOnce();
  });
  expect(screen.getByText("Not selected")).toBeVisible();
  expect(screen.getByRole("button", { name: "Unlock" })).toBeDisabled();
});

test("unlock form ignores an empty credential submit and Escape returns home", async () => {
  const unlockVault = vi
    .fn()
    .mockResolvedValue({ ...mutationSnapshot, dirty: false });
  const api = mutationApi({ unlockVault });
  render(<LockedView api={api} onUnlocked={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "Open existing vault" }));
  await screen.findByText("fixture.kdbx");
  const form = screen.getByLabelText("Master password").closest("form");
  if (form === null) throw new Error("unlock form missing");

  fireEvent.submit(form);
  expect(unlockVault).not.toHaveBeenCalled();

  fireEvent.keyDown(form, { key: "Escape" });
  expect(screen.getByRole("heading", { name: "Your vaults" })).toBeVisible();
});

test("keyfile picker failures keep the unlock flow recoverable and another vault can replace it", async () => {
  const selectVault = vi
    .fn()
    .mockResolvedValueOnce({ fileName: "first.kdbx" })
    .mockResolvedValueOnce({ fileName: "second.kdbx" });
  const selectKeyfile = vi
    .fn()
    .mockRejectedValueOnce(new DesktopCommandError("invalid_request"))
    .mockResolvedValueOnce({ fileName: "fixture.keyx" });
  const clearKeyfile = vi
    .fn()
    .mockRejectedValue(new DesktopCommandError("invalid_request"));
  const api = mutationApi({ selectVault, selectKeyfile, clearKeyfile });
  render(<LockedView api={api} onUnlocked={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "Open existing vault" }));
  expect(await screen.findByText("first.kdbx")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Choose key file" }));
  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not complete that vault operation",
    );
  });

  fireEvent.click(screen.getByRole("button", { name: "Choose key file" }));
  expect(await screen.findByText("fixture.keyx")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => {
    expect(clearKeyfile).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not complete that vault operation",
    );
  });
  expect(screen.getByText("fixture.keyx")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Choose another vault" }));
  expect(await screen.findByText("second.kdbx")).toBeVisible();
  expect(selectVault).toHaveBeenCalledTimes(2);
});
