import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import App from "./App";
import { DesktopCommandError, type DesktopApi } from "./lib/desktop";
import type { VaultSnapshotDto } from "./types/desktop";

afterEach(cleanup);

const snapshot: VaultSnapshotDto = {
  rootGroupId: "group-root",
  groups: [
    {
      id: "group-root",
      name: "Root",
      childGroupIds: ["group-work"],
      entryIds: ["entry-visible", "entry-protected"],
    },
    {
      id: "group-work",
      name: "Work",
      childGroupIds: [],
      entryIds: [],
    },
  ],
  entries: [
    {
      id: "entry-visible",
      groupId: "group-root",
      title: { kind: "visible", value: "Example Account" },
      username: { kind: "visible", value: "user@example.com" },
      url: { kind: "visible", value: "https://example.com" },
      passwordPresent: true,
      notesPresent: false,
      tags: [],
    },
    {
      id: "entry-protected",
      groupId: "group-root",
      title: { kind: "protected" },
      username: { kind: "missing" },
      url: { kind: "visible", value: "" },
      passwordPresent: false,
      notesPresent: true,
      tags: [],
    },
  ],
};

function api(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    selectVault: vi.fn().mockResolvedValue({ fileName: "test-vault.kdbx" }),
    unlockVault: vi.fn().mockResolvedValue(snapshot),
    getVaultSnapshot: vi.fn().mockResolvedValue(snapshot),
    lockVault: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function selectAndEnterPassword() {
  fireEvent.click(screen.getByRole("button", { name: "Choose KDBX file" }));
  await screen.findByText("test-vault.kdbx");
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "temporary-password" },
  });
}

test("locked view exposes selection, password, and safe unlock state", () => {
  render(<App api={api()} />);
  expect(
    screen.getByRole("button", { name: "Choose KDBX file" }),
  ).toBeEnabled();
  expect(screen.getByLabelText("Master password")).toHaveAttribute(
    "type",
    "password",
  );
  expect(screen.getByRole("button", { name: "Unlock" })).toBeDisabled();
});

test("successful unlock renders groups and direct entries", async () => {
  render(<App api={api()} />);
  await selectAndEnterPassword();
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

  expect(
    await screen.findByRole("navigation", { name: "Vault groups" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: /Root/ })).toBeVisible();
  expect(screen.getByText("Example Account")).toBeVisible();
  expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
});

test("group and entry selection exercise the browse-only navigation state", async () => {
  render(<App api={api()} />);
  await selectAndEnterPassword();
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

  fireEvent.click(await screen.findByRole("button", { name: /Work/ }));
  expect(screen.getByText("No entries in this group.")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /Root/ }));
  const entry = screen.getByRole("button", { name: /Example Account/ });
  fireEvent.click(entry);
  expect(entry).toHaveClass("selected");
});

test("unlock failure is generic and clears the password field", async () => {
  const failedApi = api({
    unlockVault: vi
      .fn()
      .mockRejectedValue(new DesktopCommandError("unlock_failed")),
  });
  render(<App api={failedApi} />);
  await selectAndEnterPassword();
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

  expect(
    await screen.findByText(
      "Could not unlock this vault. Check the password and try again.",
    ),
  ).toBeVisible();
  expect(screen.getByLabelText("Master password")).toHaveValue("");
});

test("lock drops the presentation state and restores the locked screen", async () => {
  const desktop = api();
  render(<App api={desktop} />);
  await selectAndEnterPassword();
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByRole("button", { name: "Lock" });

  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  await waitFor(() => {
    expect(desktop.lockVault).toHaveBeenCalledOnce();
  });
  expect(
    await screen.findByRole("button", { name: "Choose KDBX file" }),
  ).toBeVisible();
  expect(screen.queryByText("Example Account")).not.toBeInTheDocument();
});

test("lock failure keeps presentation state and renders only safe guidance", async () => {
  const desktop = api({
    lockVault: vi.fn().mockRejectedValue(new DesktopCommandError("internal")),
  });
  render(<App api={desktop} />);
  await selectAndEnterPassword();
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  fireEvent.click(await screen.findByRole("button", { name: "Lock" }));

  expect(
    await screen.findByText(
      "Nian Pass could not lock the vault. Close the application to drop the session.",
    ),
  ).toBeVisible();
  expect(screen.getByText("Example Account")).toBeVisible();
});

test("protected summaries render a marker without plaintext", async () => {
  render(<App api={api()} />);
  await selectAndEnterPassword();
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

  const protectedMarker = await screen.findByLabelText("Protected");
  expect(protectedMarker).toHaveTextContent("••••••");
  expect(
    screen.queryByText("hidden-protected-plaintext"),
  ).not.toBeInTheDocument();
});
