import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { EntrySummaryDto, GroupDto } from "../../types/desktop";
import { EntryList } from "./EntryList";

afterEach(cleanup);

const group: GroupDto = {
  id: "group-root",
  name: "Root",
  childGroupIds: [],
  entryIds: ["expired", "future"],
};

function entry(id: string, expiresAtUnixSeconds: number): EntrySummaryDto {
  return {
    id,
    groupId: group.id,
    title: { kind: "visible", value: id },
    username: { kind: "missing" },
    url: { kind: "missing" },
    passwordPresent: false,
    notesPresent: false,
    totpPresent: false,
    tags: [],
    expiresAtUnixSeconds,
    icon: { kind: "none" },
  };
}

test("entry list distinguishes expired entries from future expiry", () => {
  const onSelect = vi.fn();
  render(
    <EntryList
      group={group}
      entries={[entry("expired", 1), entry("future", 4_000_000_000)]}
      selectedEntryId={null}
      onSelect={onSelect}
    />,
  );

  expect(screen.getByText("Expired")).toBeVisible();
  expect(screen.getByText("Expiry set")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /future/i }));
  expect(onSelect).toHaveBeenCalledWith("future");
});

test("entry list surfaces bounded secret-free tags and TOTP presence", () => {
  const tagged = {
    ...entry("tagged", 4_000_000_000),
    totpPresent: true,
    tags: ["finance", "primary", "shared", "work"],
  } satisfies EntrySummaryDto;

  render(
    <EntryList
      group={group}
      entries={[tagged]}
      selectedEntryId={null}
      onSelect={vi.fn()}
    />,
  );

  const metadata = screen.getByLabelText("Entry metadata");
  expect(metadata).toHaveTextContent("TOTP");
  expect(metadata).toHaveTextContent("finance");
  expect(metadata).toHaveTextContent("primary");
  expect(metadata).toHaveTextContent("+2 tags");
  expect(metadata).not.toHaveTextContent("shared");
  expect(metadata).not.toHaveTextContent("work");
});

test("entry rows support arrow and boundary-key navigation without toggling bulk selection", () => {
  const onSelect = vi.fn();
  const onToggleSelection = vi.fn();
  const entries = [
    entry("first", 4_000_000_000),
    entry("second", 4_000_000_000),
  ];
  const view = render(
    <EntryList
      group={group}
      entries={entries}
      selectedEntryId="first"
      onSelect={onSelect}
    />,
  );

  const first = screen.getByRole("button", { name: /first/i });
  const second = screen.getByRole("button", { name: /second/i });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(second).toHaveFocus();
  expect(onSelect).toHaveBeenCalledWith("second");

  fireEvent.keyDown(second, { key: "Home" });
  expect(first).toHaveFocus();
  expect(onSelect).toHaveBeenCalledWith("first");

  onSelect.mockClear();
  view.rerender(
    <EntryList
      group={group}
      entries={entries}
      selectedEntryId={null}
      onSelect={onSelect}
      selectionMode
      selectedEntryIds={new Set()}
      onToggleSelection={onToggleSelection}
    />,
  );

  const bulkFirst = screen.getByRole("checkbox", { name: /first/i });
  const bulkSecond = screen.getByRole("checkbox", { name: /second/i });
  bulkFirst.focus();
  fireEvent.keyDown(bulkFirst, { key: "End" });
  expect(bulkSecond).toHaveFocus();
  expect(onSelect).not.toHaveBeenCalled();
  expect(onToggleSelection).not.toHaveBeenCalled();
});
