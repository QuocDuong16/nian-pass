import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { DesktopApi } from "../../lib/desktop";
import type { EntryDetailDto } from "../../types/desktop";
import { EntryDetail } from "./EntryDetail";
import { SECRET_REVEAL_MS } from "./useSecretReveal";

const PASSWORD = "test-secret-password-M4.2";
const NOTES = "test-secret-notes-M4.2\nsecond line";

function deferredSecret() {
  let resolve: (value: string) => void = () => undefined;
  const promise = new Promise<string>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

const detail: EntryDetailDto = {
  id: "entry-a",
  title: { kind: "visible", value: "Account A" },
  username: { kind: "protected" },
  url: { kind: "visible", value: "https://example.test" },
  passwordPresent: true,
  notesPresent: true,
  totpPresent: false,
  tags: ["work"],
  expiresAtUnixSeconds: null,
  icon: { kind: "none" },
  customFields: [
    { name: "Recovery hint", protection: "protected" },
    { name: "Region", protection: "unprotected" },
  ],
};

const groups = [
  { id: "group-root", name: "Root", childGroupIds: [], entryIds: ["entry-a"] },
];

function api(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    selectVault: vi.fn().mockResolvedValue(null),
    selectKeyfile: vi.fn().mockResolvedValue(null),
    clearKeyfile: vi.fn().mockResolvedValue(undefined),
    credentialHasKeyfile: vi.fn().mockResolvedValue(false),
    credentialHasPassword: vi.fn().mockResolvedValue(true),
    replaceKeyfile: vi.fn().mockResolvedValue({ fileName: "replacement.keyx" }),
    removeKeyfile: vi.fn().mockResolvedValue(undefined),
    removeMasterPassword: vi.fn().mockRejectedValue(new Error("unused")),
    createVault: vi.fn().mockResolvedValue(null),
    unlockVault: vi.fn().mockRejectedValue(new Error("unused")),
    unlockVaultWithKeyfile: vi.fn().mockRejectedValue(new Error("unused")),
    getVaultSnapshot: vi.fn().mockRejectedValue(new Error("unused")),
    saveVault: vi.fn().mockRejectedValue(new Error("unused")),
    exportVaultCopy: vi.fn().mockRejectedValue(new Error("unused")),
    getDatabaseMetadata: vi.fn().mockRejectedValue(new Error("unused")),
    updateDatabaseMetadata: vi.fn().mockRejectedValue(new Error("unused")),
    getHistoryPolicy: vi.fn().mockRejectedValue(new Error("unused")),
    setHistoryMaxItems: vi.fn().mockRejectedValue(new Error("unused")),
    setRecycleBinEnabled: vi.fn().mockRejectedValue(new Error("unused")),
    changeMasterPassword: vi.fn().mockRejectedValue(new Error("unused")),
    reloadVault: vi.fn().mockRejectedValue(new Error("unused")),
    getEntryDetail: vi.fn().mockImplementation((entryId: string) =>
      Promise.resolve({
        ...detail,
        id: entryId,
        title: { kind: "visible", value: `Account ${entryId}` },
      }),
    ),
    getPasswordHealthReport: vi.fn().mockResolvedValue({
      totalEntries: 1,
      passwordEntries: 1,
      minimumLength: 12,
      issues: [],
    }),
    getEntryHistory: vi
      .fn()
      .mockResolvedValue({ documentRevision: "0", items: [] }),
    restoreEntryHistory: vi.fn().mockRejectedValue(new Error("unused")),
    getEntryAttachments: vi.fn().mockResolvedValue([]),
    importEntryCustomIcon: vi.fn().mockRejectedValue(new Error("unused")),
    importEntryAttachment: vi.fn().mockRejectedValue(new Error("unused")),
    exportEntryAttachment: vi.fn().mockRejectedValue(new Error("unused")),
    revealEntryPassword: vi.fn().mockResolvedValue(PASSWORD),
    revealEntryTotp: vi.fn().mockResolvedValue({
      code: "654321",
      validForSeconds: 20,
      periodSeconds: 30,
    }),
    revealEntryNotes: vi.fn().mockResolvedValue(NOTES),
    revealEntryTitle: vi.fn().mockResolvedValue("Account A"),
    revealEntryUsername: vi.fn().mockResolvedValue("protected-user"),
    revealEntryUrl: vi.fn().mockResolvedValue("https://example.test"),
    openEntryUrl: vi.fn().mockResolvedValue(undefined),
    revealEntryCustomField: vi.fn().mockResolvedValue("custom-value"),
    copyEntryCustomField: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryTitle: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryUsername: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryUrl: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryNotes: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyGeneratedPassword: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryPassword: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryTotp: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    setEntryTags: vi.fn().mockResolvedValue({
      dirty: true,
      fileName: "fixture.kdbx",
      capabilities: {
        formatVersion: "4.1",
        writable: true,
        writeRestriction: null,
      },
      recycleBinEnabled: true,
      recycleBinGroupId: null,
      rootGroupId: "group-root",
      groups,
      entries: [],
    }),
    updateEntry: vi.fn().mockResolvedValue({
      dirty: true,
      fileName: "fixture.kdbx",
      capabilities: {
        formatVersion: "4.1",
        writable: true,
        writeRestriction: null,
      },
      recycleBinEnabled: true,
      recycleBinGroupId: null,
      rootGroupId: "group-root",
      groups,
      entries: [],
    }),
    createEntry: vi.fn().mockRejectedValue(new Error("unused")),
    duplicateEntry: vi.fn().mockRejectedValue(new Error("unused")),
    deleteEntry: vi.fn().mockRejectedValue(new Error("unused")),
    restoreEntry: vi.fn().mockRejectedValue(new Error("unused")),
    permanentlyDeleteEntry: vi.fn().mockRejectedValue(new Error("unused")),
    moveEntry: vi.fn().mockRejectedValue(new Error("unused")),
    moveEntries: vi.fn().mockRejectedValue(new Error("unused")),
    trashEntries: vi.fn().mockRejectedValue(new Error("unused")),
    restoreEntries: vi.fn().mockRejectedValue(new Error("unused")),
    permanentlyDeleteEntries: vi.fn().mockRejectedValue(new Error("unused")),
    createGroup: vi.fn().mockRejectedValue(new Error("unused")),
    renameGroup: vi.fn().mockRejectedValue(new Error("unused")),
    moveGroup: vi.fn().mockRejectedValue(new Error("unused")),
    deleteGroup: vi.fn().mockRejectedValue(new Error("unused")),
    restoreGroup: vi.fn().mockRejectedValue(new Error("unused")),
    permanentlyDeleteGroup: vi.fn().mockRejectedValue(new Error("unused")),
    setEntryCustomField: vi.fn().mockRejectedValue(new Error("unused")),
    deleteEntryCustomField: vi.fn().mockRejectedValue(new Error("unused")),
    closePolicy: vi.fn().mockResolvedValue({ policy: "allow" }),
    lockVault: vi.fn().mockResolvedValue({ clipboard: "not_owned" }),
    discardChangesAndLock: vi
      .fn()
      .mockResolvedValue({ clipboard: "not_owned" }),
    syncProfiles: vi.fn().mockResolvedValue([]),
    saveSyncProfile: vi.fn(),
    deleteSyncProfile: vi.fn(),
    resetSyncState: vi.fn(),
    testSyncProvider: vi.fn(),
    syncNow: vi.fn(),
    resolveSyncConflict: vi.fn(),
    ...overrides,
  };
}

async function renderReady(desktop = api(), entryId = "entry-a") {
  const view = render(
    <EntryDetail
      api={desktop}
      entryId={entryId}
      groups={groups}
      disabled={false}
      onSnapshot={vi.fn()}
      onDeleted={vi.fn()}
      onMoved={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: `Account ${entryId}` });
  return { desktop, ...view };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

test("visible URL opens through the semantic backend command while protected URL has no open action", async () => {
  const openEntryUrl = vi.fn().mockResolvedValue(undefined);
  await renderReady(api({ openEntryUrl }));
  fireEvent.click(screen.getByRole("button", { name: "Open URL" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Opened in the default browser",
  );
  expect(openEntryUrl).toHaveBeenCalledWith("entry-a");
  cleanup();

  const protectedApi = api({
    getEntryDetail: vi
      .fn()
      .mockResolvedValue({ ...detail, url: { kind: "protected" } }),
  });
  render(
    <EntryDetail
      api={protectedApi}
      entryId="entry-a"
      groups={groups}
      disabled={false}
      onSnapshot={vi.fn()}
      onDeleted={vi.fn()}
      onMoved={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: "Account A" });
  expect(
    screen.queryByRole("button", { name: "Open URL" }),
  ).not.toBeInTheDocument();
});

test("URL opening failure stays local and does not mutate entry state", async () => {
  const openEntryUrl = vi.fn().mockRejectedValue(new Error("synthetic"));
  await renderReady(api({ openEntryUrl }));
  fireEvent.click(screen.getByRole("button", { name: "Open URL" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Could not open this URL",
  );
  expect(openEntryUrl).toHaveBeenCalledTimes(1);
});

test("safe detail renders protected metadata without secret plaintext", async () => {
  await renderReady();
  expect(screen.getByText("Recovery hint")).toBeVisible();
  expect(screen.getAllByText("Protected").length).toBeGreaterThan(0);
  expect(document.body).not.toHaveTextContent(PASSWORD);
  expect(document.body).not.toHaveTextContent(NOTES);
  expect(screen.getByText("••••••••")).toBeVisible();
});

test("password reveal is explicit, loading-safe, and times out from state", async () => {
  let resolvePassword: (value: string) => void = () => undefined;
  const passwordPromise = new Promise<string>((resolve) => {
    resolvePassword = resolve;
  });
  const desktop = api({
    revealEntryPassword: vi.fn().mockReturnValue(passwordPromise),
  });
  await renderReady(desktop);

  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  expect(
    await screen.findByRole("button", { name: "Revealing…" }),
  ).toBeDisabled();
  expect(desktop.revealEntryPassword).toHaveBeenCalledOnce();
  vi.useFakeTimers();
  await act(async () => {
    resolvePassword(PASSWORD);
    await passwordPromise;
  });
  expect(screen.getByText(PASSWORD)).toBeVisible();

  act(() => {
    vi.advanceTimersByTime(SECRET_REVEAL_MS - 100);
  });
  expect(screen.getByText(PASSWORD)).toBeVisible();
  act(() => {
    vi.advanceTimersByTime(101);
  });
  expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
  expect(screen.getByText("••••••••")).toBeVisible();
});

test("Hide removes password immediately after a reveal", async () => {
  let resolvePassword: (value: string) => void = () => undefined;
  const pending = new Promise<string>((resolve) => {
    resolvePassword = resolve;
  });
  const revealPassword = vi.fn().mockReturnValue(pending);
  await renderReady(api({ revealEntryPassword: revealPassword }));
  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  await waitFor(() => {
    expect(revealPassword).toHaveBeenCalledOnce();
  });
  await act(async () => {
    resolvePassword(PASSWORD);
    await pending;
  });
  expect(await screen.findByText(PASSWORD)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
  expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
});

test("late reveal for entry A never appears after selection changes to B", async () => {
  let resolvePassword: (value: string) => void = () => undefined;
  const passwordPromise = new Promise<string>((resolve) => {
    resolvePassword = resolve;
  });
  const desktop = api({
    revealEntryPassword: vi.fn().mockReturnValue(passwordPromise),
  });
  const { rerender } = await renderReady(desktop, "entry-a");
  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  expect(
    await screen.findByRole("button", { name: "Revealing…" }),
  ).toBeDisabled();
  rerender(
    <EntryDetail
      api={desktop}
      entryId="entry-b"
      groups={groups}
      disabled={false}
      onSnapshot={vi.fn()}
      onDeleted={vi.fn()}
      onMoved={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: "Account entry-b" });
  await act(async () => {
    resolvePassword(PASSWORD);
    await passwordPromise;
  });
  expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
  expect(screen.getByText("••••••••")).toBeVisible();
});

test("an already revealed password clears when entry selection changes", async () => {
  const revealEntryPassword = vi.fn().mockResolvedValue(PASSWORD);
  const desktop = api({ revealEntryPassword });
  const { rerender } = await renderReady(desktop, "entry-a");
  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  expect(await screen.findByText(PASSWORD)).toBeVisible();
  rerender(
    <EntryDetail
      api={desktop}
      entryId="entry-b"
      groups={groups}
      disabled={false}
      onSnapshot={vi.fn()}
      onDeleted={vi.fn()}
      onMoved={vi.fn()}
    />,
  );
  expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
  await screen.findByRole("heading", { name: "Account entry-b" });
  expect(screen.getByText("••••••••")).toBeVisible();
});

test("notes require reveal, preserve line breaks, hide, and time out", async () => {
  const revealNotes = vi.fn().mockResolvedValue(NOTES);
  await renderReady(api({ revealEntryNotes: revealNotes }));
  fireEvent.click(screen.getByRole("button", { name: "Reveal notes" }));
  expect(
    (await screen.findByText(/test-secret-notes-M4\.2/, {}, { timeout: 5_000 }))
      .textContent,
  ).toBe(NOTES);
  fireEvent.click(screen.getByRole("button", { name: "Hide notes" }));
  expect(screen.queryByText(/test-secret-notes-M4\.2/)).not.toBeInTheDocument();

  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Reveal notes" }));
  await act(async () => {
    await revealNotes.mock.results[1]?.value;
    await Promise.resolve();
  });
  act(() => {
    vi.advanceTimersByTime(SECRET_REVEAL_MS + 1);
  });
  expect(screen.queryByText(/test-secret-notes-M4\.2/)).not.toBeInTheDocument();
});

test("blur and hidden visibility clear both revealed secrets", async () => {
  const firstPassword = deferredSecret();
  const secondPassword = deferredSecret();
  const notes = deferredSecret();
  const revealPassword = vi
    .fn()
    .mockReturnValueOnce(firstPassword.promise)
    .mockReturnValueOnce(secondPassword.promise);
  const revealNotes = vi.fn().mockReturnValue(notes.promise);
  await renderReady(
    api({
      revealEntryPassword: revealPassword,
      revealEntryNotes: revealNotes,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  fireEvent.click(screen.getByRole("button", { name: "Reveal notes" }));
  await act(async () => {
    firstPassword.resolve(PASSWORD);
    notes.resolve(NOTES);
    await Promise.all([firstPassword.promise, notes.promise]);
  });
  expect(screen.getByText(PASSWORD)).toBeVisible();
  expect(screen.getByText(/test-secret-notes-M4\.2/)).toBeVisible();
  act(() => {
    window.dispatchEvent(new Event("blur"));
  });
  expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
  expect(screen.queryByText(/test-secret-notes-M4\.2/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  await act(async () => {
    secondPassword.resolve(PASSWORD);
    await secondPassword.promise;
  });
  expect(screen.getByText(PASSWORD)).toBeVisible();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
});

test("expiry metadata renders without requiring a secret reveal", async () => {
  const desktop = api({
    getEntryDetail: vi.fn().mockResolvedValue({
      ...detail,
      title: { kind: "visible", value: "Account entry-a" },
      expiresAtUnixSeconds: 1,
      icon: { kind: "none" },
    }),
  });
  await renderReady(desktop);
  expect(screen.getByText("Expired")).toBeVisible();
  expect(screen.getByRole("time")).toHaveAttribute(
    "datetime",
    new Date(1000).toISOString(),
  );
  expect(desktop.revealEntryPassword).not.toHaveBeenCalled();
});

test("title password username URL and notes copies use semantic clipboard APIs", async () => {
  const desktop = api();
  await renderReady(desktop);
  fireEvent.click(screen.getByRole("button", { name: "Copy title" }));
  await screen.findByText("Copied. Clipboard clears in 30s if unchanged.");
  expect(desktop.copyEntryTitle).toHaveBeenCalledWith("entry-a");
  expect(desktop.revealEntryTitle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
  await screen.findByText("Copied. Clipboard clears in 30s if unchanged.");
  expect(desktop.copyEntryPassword).toHaveBeenCalledWith("entry-a");
  expect(desktop.revealEntryPassword).not.toHaveBeenCalled();
  expect(document.body).not.toHaveTextContent(PASSWORD);

  fireEvent.click(screen.getByRole("button", { name: "Copy username" }));
  await screen.findByText("Copied. Clipboard clears in 30s if unchanged.");
  expect(desktop.copyEntryUsername).toHaveBeenCalledWith("entry-a");

  fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));
  await screen.findByText("Copied. Clipboard clears in 30s if unchanged.");
  expect(desktop.copyEntryUrl).toHaveBeenCalledWith("entry-a");

  const copyNotes = screen.getByRole("button", { name: "Copy notes" });
  await waitFor(() => {
    expect(copyNotes).toBeEnabled();
  });
  fireEvent.click(copyNotes);
  await screen.findByText("Copied. Clipboard clears in 30s if unchanged.");
  expect(desktop.copyEntryNotes).toHaveBeenCalledWith("entry-a");
  expect(desktop.revealEntryNotes).not.toHaveBeenCalled();
});

test("protected title copies without revealing plaintext to React", async () => {
  const desktop = api({
    getEntryDetail: vi.fn().mockResolvedValue({
      ...detail,
      title: { kind: "protected" },
    }),
  });
  render(
    <EntryDetail
      api={desktop}
      entryId="entry-a"
      groups={groups}
      disabled={false}
      onSnapshot={vi.fn()}
      onDeleted={vi.fn()}
      onMoved={vi.fn()}
    />,
  );
  const copyTitle = await screen.findByRole("button", { name: "Copy title" });
  fireEvent.click(copyTitle);
  await screen.findByText("Copied. Clipboard clears in 30s if unchanged.");
  expect(desktop.copyEntryTitle).toHaveBeenCalledWith("entry-a");
  expect(desktop.revealEntryTitle).not.toHaveBeenCalled();
});

test("protected URL can copy without reveal and never exposes an Open action", async () => {
  const desktop = api({
    getEntryDetail: vi.fn().mockResolvedValue({
      ...detail,
      title: { kind: "visible", value: "Account entry-a" },
      url: { kind: "protected" },
    }),
  });
  await renderReady(desktop);

  expect(
    screen.queryByRole("button", { name: "Open URL" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));
  await screen.findByText("Copied. Clipboard clears in 30s if unchanged.");
  expect(desktop.copyEntryUrl).toHaveBeenCalledWith("entry-a");
  expect(desktop.revealEntryUrl).not.toHaveBeenCalled();
});

test("clipboard failure shows generic safe feedback", async () => {
  await renderReady(
    api({ copyEntryPassword: vi.fn().mockRejectedValue(new Error(PASSWORD)) }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
  expect(
    await screen.findByText("Could not copy to the clipboard."),
  ).toBeVisible();
  expect(document.body).not.toHaveTextContent(PASSWORD);
});

test("disabling for Lock clears a pending reveal and blocks late completion", async () => {
  let resolvePassword: (value: string) => void = () => undefined;
  const pending = new Promise<string>((resolve) => {
    resolvePassword = resolve;
  });
  const desktop = api({
    revealEntryPassword: vi.fn().mockReturnValue(pending),
  });
  const { rerender } = await renderReady(desktop);
  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  rerender(
    <EntryDetail
      api={desktop}
      entryId="entry-a"
      groups={groups}
      disabled
      onSnapshot={vi.fn()}
      onDeleted={vi.fn()}
      onMoved={vi.fn()}
    />,
  );
  await act(async () => {
    resolvePassword(PASSWORD);
    await pending;
  });
  expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
});

test("detail load failure is generic and edit Cancel returns to read-only mode", async () => {
  const failed = api({
    getEntryDetail: vi.fn().mockRejectedValue(new Error(PASSWORD)),
  });
  render(
    <EntryDetail
      api={failed}
      entryId="entry-a"
      groups={groups}
      disabled={false}
      onSnapshot={vi.fn()}
      onDeleted={vi.fn()}
      onMoved={vi.fn()}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load this entry",
  );
  cleanup();

  await renderReady();
  fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Edit entry" })).toBeVisible();
});
