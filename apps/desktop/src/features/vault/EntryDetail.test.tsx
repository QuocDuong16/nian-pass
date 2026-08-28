import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { DesktopApi } from "../../lib/desktop";
import type { EntryDetailDto } from "../../types/desktop";
import { EntryDetail } from "./EntryDetail";
import { SECRET_REVEAL_MS } from "./useSecretReveal";

const PASSWORD = "test-secret-password-M4.2";
const NOTES = "test-secret-notes-M4.2\nsecond line";

const detail: EntryDetailDto = {
  id: "entry-a",
  title: { kind: "visible", value: "Account A" },
  username: { kind: "protected" },
  url: { kind: "visible", value: "https://example.test" },
  passwordPresent: true,
  notesPresent: true,
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
    unlockVault: vi.fn().mockRejectedValue(new Error("unused")),
    getVaultSnapshot: vi.fn().mockRejectedValue(new Error("unused")),
    saveVault: vi.fn().mockRejectedValue(new Error("unused")),
    reloadVault: vi.fn().mockRejectedValue(new Error("unused")),
    getEntryDetail: vi.fn().mockImplementation((entryId: string) =>
      Promise.resolve({
        ...detail,
        id: entryId,
        title: { kind: "visible", value: `Account ${entryId}` },
      }),
    ),
    revealEntryPassword: vi.fn().mockResolvedValue(PASSWORD),
    revealEntryNotes: vi.fn().mockResolvedValue(NOTES),
    revealEntryTitle: vi.fn().mockResolvedValue("Account A"),
    revealEntryUsername: vi.fn().mockResolvedValue("protected-user"),
    revealEntryUrl: vi.fn().mockResolvedValue("https://example.test"),
    revealEntryCustomField: vi.fn().mockResolvedValue("custom-value"),
    copyEntryUsername: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryPassword: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    updateEntry: vi.fn().mockResolvedValue({
      dirty: true,
      rootGroupId: "group-root",
      groups,
      entries: [],
    }),
    createEntry: vi.fn().mockRejectedValue(new Error("unused")),
    deleteEntry: vi.fn().mockRejectedValue(new Error("unused")),
    moveEntry: vi.fn().mockRejectedValue(new Error("unused")),
    createGroup: vi.fn().mockRejectedValue(new Error("unused")),
    renameGroup: vi.fn().mockRejectedValue(new Error("unused")),
    moveGroup: vi.fn().mockRejectedValue(new Error("unused")),
    deleteGroup: vi.fn().mockRejectedValue(new Error("unused")),
    setEntryCustomField: vi.fn().mockRejectedValue(new Error("unused")),
    deleteEntryCustomField: vi.fn().mockRejectedValue(new Error("unused")),
    closePolicy: vi.fn().mockResolvedValue({ policy: "allow" }),
    lockVault: vi.fn().mockResolvedValue({ clipboard: "not_owned" }),
    discardChangesAndLock: vi
      .fn()
      .mockResolvedValue({ clipboard: "not_owned" }),
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
  vi.useFakeTimers();

  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  expect(screen.getByRole("button", { name: "Revealing…" })).toBeDisabled();
  expect(desktop.revealEntryPassword).toHaveBeenCalledOnce();
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

test("Hide removes password immediately and cancels its timer", async () => {
  const revealPassword = vi.fn().mockResolvedValue(PASSWORD);
  await renderReady(api({ revealEntryPassword: revealPassword }));
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  await act(async () => {
    await revealPassword.mock.results[0]?.value;
  });
  fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
  expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
  act(() => {
    vi.runAllTimers();
  });
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
  const desktop = api();
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
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Reveal notes" }));
  await act(async () => {
    await revealNotes.mock.results[0]?.value;
  });
  expect(screen.getByText(/test-secret-notes-M4\.2/).textContent).toBe(NOTES);
  fireEvent.click(screen.getByRole("button", { name: "Hide notes" }));
  expect(screen.queryByText(/test-secret-notes-M4\.2/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Reveal notes" }));
  await act(async () => {
    await revealNotes.mock.results[1]?.value;
  });
  act(() => {
    vi.advanceTimersByTime(SECRET_REVEAL_MS + 1);
  });
  expect(screen.queryByText(/test-secret-notes-M4\.2/)).not.toBeInTheDocument();
});

test("blur and hidden visibility clear both revealed secrets", async () => {
  const revealPassword = vi.fn().mockResolvedValue(PASSWORD);
  const revealNotes = vi.fn().mockResolvedValue(NOTES);
  await renderReady(
    api({
      revealEntryPassword: revealPassword,
      revealEntryNotes: revealNotes,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  fireEvent.click(screen.getByRole("button", { name: "Reveal notes" }));
  await act(async () => {
    await Promise.all([
      revealPassword.mock.results[0]?.value,
      revealNotes.mock.results[0]?.value,
    ]);
  });
  expect(screen.getByText(PASSWORD)).toBeVisible();
  act(() => {
    window.dispatchEvent(new Event("blur"));
  });
  expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
  expect(screen.queryByText(/test-secret-notes-M4\.2/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Reveal password" }));
  await act(async () => {
    await revealPassword.mock.results[1]?.value;
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
});

test("copy password stays hidden and copy username uses semantic APIs", async () => {
  const desktop = api();
  await renderReady(desktop);
  fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
  await screen.findByText("Copied. Clipboard clears in 30s if unchanged.");
  expect(desktop.copyEntryPassword).toHaveBeenCalledWith("entry-a");
  expect(desktop.revealEntryPassword).not.toHaveBeenCalled();
  expect(document.body).not.toHaveTextContent(PASSWORD);

  fireEvent.click(screen.getByRole("button", { name: "Copy username" }));
  await screen.findByText("Copied. Clipboard clears in 30s if unchanged.");
  expect(desktop.copyEntryUsername).toHaveBeenCalledWith("entry-a");
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
