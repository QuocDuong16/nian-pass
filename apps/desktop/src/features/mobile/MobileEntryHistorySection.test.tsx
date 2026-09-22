import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { createMobileApi } from "../../test/mobile-api";
import { MobileEntryHistorySection } from "./MobileEntryHistorySection";

afterEach(cleanup);

const history = {
  documentRevision: "9",
  items: [
    {
      index: 0,
      modifiedAtUnixSeconds: null,
      title: { kind: "visible" as const, value: "Older account" },
      username: { kind: "missing" as const },
      url: { kind: "missing" as const },
      passwordPresent: true,
      notesPresent: true,
      totpPresent: false,
      tags: ["legacy"],
      expiresAtUnixSeconds: null,
      restorable: true,
    },
  ],
};

test("history remains on-demand and renders only secret-free revision metadata", async () => {
  const getEntryHistory = vi.fn().mockResolvedValue(history);
  const api = createMobileApi({ getEntryHistory });
  render(
    <MobileEntryHistorySection
      api={api}
      entryId="entry-a"
      disabled={false}
      onBusyChange={vi.fn()}
    />,
  );

  expect(getEntryHistory).not.toHaveBeenCalled();
  expect(
    screen.getByText("History is loaded only when requested."),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Load history" }));

  await waitFor(() => {
    expect(getEntryHistory).toHaveBeenCalledWith("entry-a");
  });
  expect(screen.getByText("Older account")).toBeInTheDocument();
  expect(
    screen.getByLabelText("Stored fields in this revision"),
  ).toHaveTextContent("Password · Notes · 1 tag(s)");
  expect(screen.getByText("Restore available on desktop")).toBeInTheDocument();
});

test("history load failures stay local and can be retried", async () => {
  const getEntryHistory = vi
    .fn()
    .mockRejectedValueOnce(new Error("synthetic"))
    .mockResolvedValueOnce({ documentRevision: "10", items: [] });
  const api = createMobileApi({ getEntryHistory });
  render(
    <MobileEntryHistorySection
      api={api}
      entryId="entry-a"
      disabled={false}
      onBusyChange={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Load history" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load entry history.",
  );

  fireEvent.click(screen.getByRole("button", { name: "Load history" }));
  expect(await screen.findByText("No previous revisions.")).toBeInTheDocument();
  expect(getEntryHistory).toHaveBeenCalledTimes(2);
});
