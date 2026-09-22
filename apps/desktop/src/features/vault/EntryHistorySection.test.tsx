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
import type { EntryHistoryDto } from "../../types/desktop";
import { EntryHistorySection } from "./EntryHistorySection";

const history: EntryHistoryDto = {
  documentRevision: "18446744073709551615",
  items: [
    {
      index: 0,
      modifiedAtUnixSeconds: 2_000_000_000,
      title: { kind: "visible", value: "Previous account" },
      username: { kind: "protected" },
      url: { kind: "missing" },
      passwordPresent: true,
      notesPresent: true,
      totpPresent: true,
      tags: ["work"],
      expiresAtUnixSeconds: null,
      restorable: true,
    },
    {
      index: 1,
      modifiedAtUnixSeconds: null,
      title: { kind: "protected" },
      username: { kind: "missing" },
      url: { kind: "missing" },
      passwordPresent: false,
      notesPresent: false,
      totpPresent: false,
      tags: [],
      expiresAtUnixSeconds: null,
      restorable: false,
    },
  ],
};

afterEach(cleanup);

test("history is lazy, secret-free, and unsupported revisions cannot restore", async () => {
  const api = mutationApi({
    getEntryHistory: vi.fn().mockResolvedValue(history),
  });
  render(
    <EntryHistorySection
      api={api}
      entryId="entry-a"
      disabled={false}
      onSnapshot={vi.fn()}
    />,
  );

  expect(api.getEntryHistory).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  expect(await screen.findByText("Previous account")).toBeVisible();
  expect(api.getEntryHistory).toHaveBeenCalledWith("entry-a");
  expect(screen.queryByText(/history-old-password/i)).not.toBeInTheDocument();
  expect(screen.getByText("Password · Notes · TOTP · 1 tag(s)")).toBeVisible();

  const restoreButtons = screen.getAllByRole("button", { name: "Restore" });
  expect(restoreButtons).toHaveLength(2);
  expect(restoreButtons[0]).toBeEnabled();
  expect(restoreButtons[1]).toBeDisabled();
});

test("restore reuses the exact opaque document revision and returns the Rust snapshot", async () => {
  const restoreEntryHistory = vi.fn().mockResolvedValue(mutationSnapshot);
  const api = mutationApi({
    getEntryHistory: vi.fn().mockResolvedValue(history),
    restoreEntryHistory,
  });
  const onSnapshot = vi.fn();
  const onDraftChange = vi.fn();
  render(
    <EntryHistorySection
      api={api}
      entryId="entry-a"
      disabled={false}
      onSnapshot={onSnapshot}
      onDraftChange={onDraftChange}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  await screen.findByText("Previous account");
  const firstRestore = screen.getAllByRole("button", { name: "Restore" })[0];
  if (firstRestore === undefined) throw new Error("restore button missing");
  fireEvent.click(firstRestore);
  expect(screen.getByRole("dialog")).toBeVisible();
  await waitFor(() => {
    expect(onDraftChange).toHaveBeenLastCalledWith(true);
  });
  fireEvent.click(screen.getByRole("button", { name: "Restore revision" }));

  await waitFor(() => {
    expect(restoreEntryHistory).toHaveBeenCalledWith(
      "entry-a",
      0,
      "18446744073709551615",
    );
  });
  expect(onSnapshot).toHaveBeenCalledWith(mutationSnapshot);
});

test("stale history is discarded and requires a fresh list", async () => {
  const getEntryHistory = vi.fn().mockResolvedValue(history);
  const api = mutationApi({
    getEntryHistory,
    restoreEntryHistory: vi
      .fn()
      .mockRejectedValue(new DesktopCommandError("history_changed")),
  });
  render(
    <EntryHistorySection
      api={api}
      entryId="entry-a"
      disabled={false}
      onSnapshot={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  await screen.findByText("Previous account");
  const firstRestore = screen.getAllByRole("button", { name: "Restore" })[0];
  if (firstRestore === undefined) throw new Error("restore button missing");
  fireEvent.click(firstRestore);
  fireEvent.click(screen.getByRole("button", { name: "Restore revision" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/History changed/);
  expect(screen.queryByText("Previous account")).not.toBeInTheDocument();
});

test("load failure can retry and empty history remains explicit", async () => {
  const getEntryHistory = vi
    .fn()
    .mockRejectedValueOnce(new Error("synthetic load failure"))
    .mockResolvedValueOnce({ documentRevision: "7", items: [] });
  const api = mutationApi({ getEntryHistory });
  render(
    <EntryHistorySection
      api={api}
      entryId="entry-a"
      disabled={false}
      onSnapshot={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load/);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("No previous revisions.")).toBeVisible();
  expect(getEntryHistory).toHaveBeenCalledTimes(2);
});

test("restore confirmation can cancel without mutation", async () => {
  const restoreEntryHistory = vi.fn();
  const api = mutationApi({
    getEntryHistory: vi.fn().mockResolvedValue(history),
    restoreEntryHistory,
  });
  render(
    <EntryHistorySection
      api={api}
      entryId="entry-a"
      disabled={false}
      onSnapshot={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  await screen.findByText("Previous account");
  const firstRestore = screen.getAllByRole("button", { name: "Restore" })[0];
  if (firstRestore === undefined) throw new Error("restore button missing");
  fireEvent.click(firstRestore);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(restoreEntryHistory).not.toHaveBeenCalled();
});

test.each([
  [
    new DesktopCommandError("history_restore_unsupported"),
    /cannot be restored safely yet/,
  ],
  [
    new Error("synthetic restore failure"),
    /Could not restore this history revision/,
  ],
])(
  "restore failure stays local and reports a bounded error",
  async (failure, message) => {
    const api = mutationApi({
      getEntryHistory: vi.fn().mockResolvedValue(history),
      restoreEntryHistory: vi.fn().mockRejectedValue(failure),
    });
    render(
      <EntryHistorySection
        api={api}
        entryId="entry-a"
        disabled={false}
        onSnapshot={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    await screen.findByText("Previous account");
    const firstRestore = screen.getAllByRole("button", { name: "Restore" })[0];
    if (firstRestore === undefined) throw new Error("restore button missing");
    fireEvent.click(firstRestore);
    fireEvent.click(screen.getByRole("button", { name: "Restore revision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  },
);
