import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { GroupDto } from "../../types/desktop";
import { GroupTree } from "./GroupTree";

afterEach(cleanup);

const groups: GroupDto[] = [
  {
    id: "root",
    name: "Vault",
    childGroupIds: ["personal", "trash"],
    entryIds: [],
  },
  {
    id: "personal",
    name: "Personal",
    childGroupIds: ["finance"],
    entryIds: ["entry-a"],
  },
  {
    id: "finance",
    name: "Finance",
    childGroupIds: [],
    entryIds: ["entry-b", "entry-c"],
  },
  {
    id: "trash",
    name: "KeePass Recycle Bin",
    childGroupIds: [],
    entryIds: ["entry-deleted"],
  },
];

function groupsById() {
  return new Map(groups.map((group) => [group.id, group]));
}

test("group tree starts expanded and collapses or expands descendants without changing KDBX order", () => {
  const onSelect = vi.fn();
  render(
    <GroupTree
      rootGroupId="root"
      groupsById={groupsById()}
      recycleBinGroupId="trash"
      selectedGroupId="root"
      onSelect={onSelect}
    />,
  );

  expect(screen.getByRole("button", { name: "Finance" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Trash" })).toBeVisible();
  const collapse = screen.getByRole("button", { name: "Collapse Personal" });
  expect(collapse).toHaveAttribute("aria-expanded", "true");

  fireEvent.click(collapse);
  expect(
    screen.queryByRole("button", { name: "Finance" }),
  ).not.toBeInTheDocument();
  expect(onSelect).not.toHaveBeenCalled();

  const expand = screen.getByRole("button", { name: "Expand Personal" });
  expect(expand).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(expand);
  expect(screen.getByRole("button", { name: "Finance" })).toBeVisible();
});

test("collapsing a parent containing the selected group selects the visible parent", () => {
  const onSelect = vi.fn();
  render(
    <GroupTree
      rootGroupId="root"
      groupsById={groupsById()}
      recycleBinGroupId="trash"
      selectedGroupId="finance"
      onSelect={onSelect}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Collapse Personal" }));
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith("personal");
  expect(
    screen.queryByRole("button", { name: "Finance" }),
  ).not.toBeInTheDocument();
});

test("group selection remains separate from disclosure state", () => {
  const onSelect = vi.fn();
  render(
    <GroupTree
      rootGroupId="root"
      groupsById={groupsById()}
      recycleBinGroupId="trash"
      selectedGroupId="root"
      onSelect={onSelect}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Personal" }));
  expect(onSelect).toHaveBeenCalledWith("personal");
  expect(screen.getByRole("button", { name: "Finance" })).toBeVisible();
});

test("group tree keyboard navigation follows visible hierarchy and disclosure state", () => {
  const onSelect = vi.fn();
  render(
    <GroupTree
      rootGroupId="root"
      groupsById={groupsById()}
      recycleBinGroupId="trash"
      selectedGroupId="root"
      onSelect={onSelect}
    />,
  );

  const root = screen.getByRole("button", { name: "Vault" });
  const personal = screen.getByRole("button", { name: "Personal" });
  const finance = screen.getByRole("button", { name: "Finance" });

  root.focus();
  fireEvent.keyDown(root, { key: "ArrowDown" });
  expect(personal).toHaveFocus();
  expect(onSelect).toHaveBeenLastCalledWith("personal");

  fireEvent.keyDown(personal, { key: "ArrowDown" });
  expect(finance).toHaveFocus();
  expect(onSelect).toHaveBeenLastCalledWith("finance");

  fireEvent.keyDown(finance, { key: "ArrowLeft" });
  expect(personal).toHaveFocus();
  expect(onSelect).toHaveBeenLastCalledWith("personal");

  fireEvent.keyDown(personal, { key: "ArrowLeft" });
  expect(
    screen.queryByRole("button", { name: "Finance" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Expand Personal" })).toBeVisible();

  fireEvent.keyDown(personal, { key: "ArrowRight" });
  expect(screen.getByRole("button", { name: "Finance" })).toBeVisible();
  fireEvent.keyDown(personal, { key: "ArrowRight" });
  expect(screen.getByRole("button", { name: "Finance" })).toHaveFocus();
  expect(onSelect).toHaveBeenLastCalledWith("finance");

  fireEvent.keyDown(screen.getByRole("button", { name: "Finance" }), {
    key: "End",
  });
  expect(screen.getByRole("button", { name: "Trash" })).toHaveFocus();
  expect(onSelect).toHaveBeenLastCalledWith("trash");
});
