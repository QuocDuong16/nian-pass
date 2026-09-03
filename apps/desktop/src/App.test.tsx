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
import type { EntryDetailDto, VaultSnapshotDto } from "./types/desktop";

afterEach(cleanup);

const snapshot: VaultSnapshotDto = {
  dirty: false,
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
      notesPresent: true,
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

const detail: EntryDetailDto = {
  id: "entry-visible",
  title: { kind: "visible", value: "Example Account" },
  username: { kind: "visible", value: "user@example.com" },
  url: { kind: "visible", value: "https://example.com" },
  passwordPresent: true,
  notesPresent: true,
  customFields: [],
};

function api(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    selectVault: vi.fn().mockResolvedValue({ fileName: "test-vault.kdbx" }),
    unlockVault: vi.fn().mockResolvedValue(snapshot),
    getVaultSnapshot: vi.fn().mockResolvedValue(snapshot),
    saveVault: vi.fn().mockResolvedValue(snapshot),
    reloadVault: vi.fn().mockResolvedValue(snapshot),
    getEntryDetail: vi.fn().mockImplementation((entryId: string) =>
      Promise.resolve({
        ...detail,
        id: entryId,
        title:
          entryId === "entry-protected"
            ? { kind: "protected" as const }
            : detail.title,
      }),
    ),
    revealEntryPassword: vi.fn().mockResolvedValue("synthetic-password-M4.2"),
    revealEntryNotes: vi.fn().mockResolvedValue("synthetic-notes-M4.2"),
    revealEntryTitle: vi.fn().mockResolvedValue("Example Account"),
    revealEntryUsername: vi.fn().mockResolvedValue("user@example.com"),
    revealEntryUrl: vi.fn().mockResolvedValue("https://example.com"),
    revealEntryCustomField: vi.fn().mockResolvedValue("synthetic-custom"),
    copyEntryUsername: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryPassword: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    updateEntry: vi.fn().mockResolvedValue(snapshot),
    createEntry: vi.fn().mockResolvedValue({
      createdEntryId: "entry-created",
      snapshot,
    }),
    deleteEntry: vi.fn().mockResolvedValue(snapshot),
    moveEntry: vi.fn().mockResolvedValue(snapshot),
    createGroup: vi.fn().mockResolvedValue({
      createdGroupId: "group-created",
      snapshot,
    }),
    renameGroup: vi.fn().mockResolvedValue(snapshot),
    moveGroup: vi.fn().mockResolvedValue(snapshot),
    deleteGroup: vi.fn().mockResolvedValue(snapshot),
    setEntryCustomField: vi.fn().mockResolvedValue(snapshot),
    deleteEntryCustomField: vi.fn().mockResolvedValue(snapshot),
    closePolicy: vi.fn().mockResolvedValue({ policy: "allow" }),
    lockVault: vi.fn().mockResolvedValue({ clipboard: "not_owned" }),
    discardChangesAndLock: vi
      .fn()
      .mockResolvedValue({ clipboard: "not_owned" }),
    syncProfiles: vi.fn().mockResolvedValue([]),
    saveSyncProfile: vi.fn(),
    deleteSyncProfile: vi.fn(),
    testSyncProvider: vi.fn(),
    syncNow: vi.fn(),
    resolveSyncConflict: vi.fn(),
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

test("group change resets entry selection and removes revealed secrets", async () => {
  const desktop = api();
  render(<App api={desktop} />);
  await selectAndEnterPassword();
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Example Account/ }),
  );
  await act(async () => {
    await vi.mocked(desktop.getEntryDetail).mock.results.at(-1)?.value;
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Reveal password" }),
  );
  expect(await screen.findByText("synthetic-password-M4.2")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /Work/ }));
  expect(screen.queryByText("synthetic-password-M4.2")).not.toBeInTheDocument();
  expect(
    screen.getByText("Select an entry to view its safe details."),
  ).toBeVisible();
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

test("Lock clears a revealed secret before the backend promise completes", async () => {
  let resolveLock: (value: { clipboard: "cleared" }) => void = () => undefined;
  const lockPromise = new Promise<{ clipboard: "cleared" }>((resolve) => {
    resolveLock = resolve;
  });
  const desktop = api({ lockVault: vi.fn().mockReturnValue(lockPromise) });
  render(<App api={desktop} />);
  await selectAndEnterPassword();
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Example Account/ }),
  );
  await act(async () => {
    await vi.mocked(desktop.getEntryDetail).mock.results.at(-1)?.value;
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Reveal password" }),
  );
  expect(await screen.findByText("synthetic-password-M4.2")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  expect(screen.queryByText("synthetic-password-M4.2")).not.toBeInTheDocument();
  resolveLock({ clipboard: "cleared" });
  expect(
    await screen.findByRole("button", { name: "Choose KDBX file" }),
  ).toBeVisible();
});

test("clipboard clear failure is reported after the vault is locked", async () => {
  render(
    <App
      api={api({
        lockVault: vi.fn().mockResolvedValue({ clipboard: "clear_failed" }),
      })}
    />,
  );
  await selectAndEnterPassword();
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  fireEvent.click(await screen.findByRole("button", { name: "Lock" }));
  expect(
    await screen.findByText(
      "Vault locked, but Nian Pass could not clear the clipboard.",
    ),
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
      "Nian Pass could not lock the vault. The unlocked session remains active.",
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
