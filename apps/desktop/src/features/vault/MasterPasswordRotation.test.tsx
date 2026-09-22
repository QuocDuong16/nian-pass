import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { DesktopCommandError } from "../../lib/desktop";
import { mutationApi, mutationSnapshot } from "../../test/desktop-api";
import { MasterPasswordRotation } from "./MasterPasswordRotation";

afterEach(cleanup);

test("credential rotation requires matching inputs and replaces the canonical snapshot", async () => {
  const cleanSnapshot = { ...mutationSnapshot, dirty: false };
  const changeMasterPassword = vi.fn().mockResolvedValue(cleanSnapshot);
  const onBusyChange = vi.fn();
  const onSnapshot = vi.fn();
  render(
    <MasterPasswordRotation
      api={mutationApi({ changeMasterPassword })}
      disabled={false}
      dirty={false}
      onBusyChange={onBusyChange}
      onSnapshot={onSnapshot}
    />,
  );

  fireEvent.change(screen.getByLabelText("New master password"), {
    target: { value: "alpha" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new master password"), {
    target: { value: "beta" },
  });
  expect(
    screen.getByRole("button", { name: "Change master password" }),
  ).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("do not match");

  fireEvent.change(screen.getByLabelText("Confirm new master password"), {
    target: { value: "alpha" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Change master password" }),
  );

  expect(await screen.findByRole("status")).toHaveTextContent(
    "vault was verified",
  );
  expect(changeMasterPassword).toHaveBeenCalledWith("alpha");
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(onSnapshot).toHaveBeenCalledWith(cleanSnapshot);
  expect(screen.getByLabelText("New master password")).toHaveValue("");
  expect(screen.getByLabelText("Confirm new master password")).toHaveValue("");
});

test("dirty vault keeps credential rotation unavailable", () => {
  const changeMasterPassword = vi.fn();
  render(
    <MasterPasswordRotation
      api={mutationApi({ changeMasterPassword })}
      disabled
      dirty
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );

  expect(
    screen.getByText(/Save or discard unsaved vault changes/),
  ).toBeVisible();
  expect(screen.getByLabelText("New master password")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Change master password" }),
  ).toBeDisabled();
  expect(changeMasterPassword).not.toHaveBeenCalled();
});

test.each([
  [
    "unsaved_changes",
    "Save or discard unsaved vault changes before changing the master password.",
  ],
  [
    "external_change",
    "The vault changed on disk. Reload it before changing the master password.",
  ],
  [
    "unsupported_persistence_platform",
    "Credential changes are not supported safely on this platform yet.",
  ],
  [
    "internal",
    "Could not change the master password. The existing vault and credential remain in use.",
  ],
] as const)(
  "credential rotation maps %s without clearing the draft",
  async (code, message) => {
    const changeMasterPassword = vi
      .fn()
      .mockRejectedValue(new DesktopCommandError(code));
    render(
      <MasterPasswordRotation
        api={mutationApi({ changeMasterPassword })}
        disabled={false}
        dirty={false}
        onBusyChange={vi.fn()}
        onSnapshot={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("New master password"), {
      target: { value: "rotation-input" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new master password"), {
      target: { value: "rotation-input" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Change master password" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("New master password")).toHaveValue(
      "rotation-input",
    );
    expect(changeMasterPassword).toHaveBeenCalledOnce();
  },
);

test("master password removal requires the native keyfile state and explicit backup acknowledgement", async () => {
  const cleanSnapshot = { ...mutationSnapshot, dirty: false };
  const removeMasterPassword = vi.fn().mockResolvedValue(cleanSnapshot);
  const changeMasterPassword = vi.fn().mockResolvedValue(cleanSnapshot);
  const onSnapshot = vi.fn();
  const onBusyChange = vi.fn();
  const api = mutationApi({ removeMasterPassword, changeMasterPassword });
  const view = render(
    <MasterPasswordRotation
      api={api}
      hasKeyfile={false}
      disabled={false}
      dirty={false}
      onBusyChange={onBusyChange}
      onSnapshot={onSnapshot}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Remove master password" }),
  ).not.toBeInTheDocument();
  view.rerender(
    <MasterPasswordRotation
      api={api}
      hasKeyfile
      disabled={false}
      dirty={false}
      onBusyChange={onBusyChange}
      onSnapshot={onSnapshot}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Remove master password" }),
  );
  const confirm = screen.getByRole("button", {
    name: "Confirm remove master password",
  });
  expect(confirm).toBeDisabled();
  expect(
    screen.getByText(/Previous backups may still use the old password/u),
  ).toBeVisible();
  expect(removeMasterPassword).not.toHaveBeenCalled();
  expect(
    screen.getByText(/Manual desktop sync uses the retained keyfile/u),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I have an accessible backup of the keyfile",
    }),
  );
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  expect(
    await screen.findByText(
      "Master password removed. The vault is keyfile-only.",
    ),
  ).toBeVisible();
  expect(onSnapshot).toHaveBeenCalledWith(cleanSnapshot);
  expect(removeMasterPassword).toHaveBeenCalledOnce();
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(
    screen.queryByRole("button", { name: "Remove master password" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("New master password"), {
    target: { value: "restored" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new master password"), {
    target: { value: "restored" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add master password" }));
  expect(
    await screen.findByText(
      "Master password changed and the vault was verified.",
    ),
  ).toBeVisible();
  expect(changeMasterPassword).toHaveBeenCalledWith("restored");
  expect(
    screen.getByRole("button", { name: "Remove master password" }),
  ).toBeVisible();
});

test("master password removal cancellation resets the backup confirmation", async () => {
  const removeMasterPassword = vi.fn();
  render(
    <MasterPasswordRotation
      api={mutationApi({ removeMasterPassword })}
      hasKeyfile
      disabled={false}
      dirty={false}
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Remove master password" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I have an accessible backup of the keyfile",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Keep master password" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Remove master password" }),
  );
  expect(
    screen.getByRole("button", { name: "Confirm remove master password" }),
  ).toBeDisabled();
  expect(removeMasterPassword).not.toHaveBeenCalled();
});

test("master password removal failure refreshes proven state without claiming success", async () => {
  const credentialHasPassword = vi.fn().mockResolvedValue(true);
  const removeMasterPassword = vi
    .fn()
    .mockRejectedValue(new DesktopCommandError("save_uncertain"));
  render(
    <MasterPasswordRotation
      api={mutationApi({ credentialHasPassword, removeMasterPassword })}
      hasKeyfile
      disabled={false}
      dirty={false}
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Remove master password" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I have an accessible backup of the keyfile",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm remove master password" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Lock and reopen");
  expect(credentialHasPassword).toHaveBeenCalledTimes(2);
  expect(
    screen.queryByText("Master password removed. The vault is keyfile-only."),
  ).not.toBeInTheDocument();
});
