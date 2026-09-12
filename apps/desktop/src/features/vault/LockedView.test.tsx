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
