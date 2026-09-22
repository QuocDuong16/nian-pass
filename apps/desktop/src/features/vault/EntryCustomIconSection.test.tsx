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
import { EntryCustomIconSection } from "./EntryCustomIconSection";

afterEach(cleanup);

test("custom icon upload uses the native semantic command and applies its snapshot", async () => {
  const importEntryCustomIcon = vi.fn().mockResolvedValue(mutationSnapshot);
  const onSnapshot = vi.fn();
  const onBusyChange = vi.fn();
  render(
    <EntryCustomIconSection
      api={mutationApi({ importEntryCustomIcon })}
      entryId="entry-a"
      icon={{ kind: "none" }}
      disabled={false}
      mutationDisabled={false}
      onSnapshot={onSnapshot}
      onBusyChange={onBusyChange}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Upload PNG" }));
  await waitFor(() => {
    expect(importEntryCustomIcon).toHaveBeenCalledWith("entry-a");
  });
  expect(onSnapshot).toHaveBeenCalledWith(mutationSnapshot);
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(screen.getByText("Custom icon applied.")).toBeInTheDocument();
});

test("custom icon upload reports cancellation and bounded PNG validation failures", async () => {
  const cancelled = vi.fn().mockResolvedValue(null);
  const { rerender } = render(
    <EntryCustomIconSection
      api={mutationApi({ importEntryCustomIcon: cancelled })}
      entryId="entry-a"
      icon={{ kind: "custom" }}
      disabled={false}
      mutationDisabled={false}
      onSnapshot={vi.fn()}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Upload PNG" }));
  expect(
    await screen.findByText("Custom icon upload cancelled."),
  ).toBeInTheDocument();

  const invalid = vi
    .fn()
    .mockRejectedValue(new DesktopCommandError("invalid_request"));
  rerender(
    <EntryCustomIconSection
      api={mutationApi({ importEntryCustomIcon: invalid })}
      entryId="entry-a"
      icon={{ kind: "custom" }}
      disabled={false}
      mutationDisabled={false}
      onSnapshot={vi.fn()}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Upload PNG" }));
  expect(
    await screen.findByText(/PNG up to 4 MiB.*4096 × 4096/i),
  ).toBeInTheDocument();
});

test("custom icon upload is unavailable when entry mutation is blocked", () => {
  render(
    <EntryCustomIconSection
      api={mutationApi()}
      entryId="entry-a"
      icon={{ kind: "non_standard" }}
      disabled={false}
      mutationDisabled={true}
      onSnapshot={vi.fn()}
      onBusyChange={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Upload PNG" })).toBeDisabled();
});
