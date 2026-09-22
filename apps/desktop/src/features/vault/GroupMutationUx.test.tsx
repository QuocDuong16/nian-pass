import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { mutationApi, mutationSnapshot } from "../../test/desktop-api";
import { GroupActions } from "./GroupActions";

afterEach(cleanup);

function group(index: number) {
  const value = mutationSnapshot.groups[index];
  if (value === undefined) throw new Error("test group missing");
  return value;
}

test("root exposes create and rename but never move or delete", () => {
  render(
    <GroupActions
      api={mutationApi()}
      group={group(0)}
      snapshot={mutationSnapshot}
      disabled={false}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Group actions" }));
  expect(screen.getByRole("menuitem", { name: "New group" })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: "Rename group" })).toBeVisible();
  expect(
    screen.queryByRole("menuitem", { name: "Move group" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "Permanently delete group" }),
  ).not.toBeInTheDocument();
});

test("group create and rename use stable selected GroupIds", async () => {
  const api = mutationApi();
  const onChanged = vi.fn();
  render(
    <GroupActions
      api={api}
      group={group(0)}
      snapshot={mutationSnapshot}
      disabled={false}
      onChanged={onChanged}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Group actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "New group" }));
  fireEvent.change(screen.getByLabelText("Group name"), {
    target: { value: "Created child" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => {
    expect(api.createGroup).toHaveBeenCalledWith("group-root", "Created child");
  });
  expect(onChanged).toHaveBeenCalledWith(mutationSnapshot, "group-created");

  fireEvent.click(screen.getByRole("button", { name: "Group actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename group" }));
  fireEvent.change(screen.getByLabelText("Group name"), {
    target: { value: "Renamed root" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => {
    expect(api.renameGroup).toHaveBeenCalledWith("group-root", "Renamed root");
  });
});

test("group move uses an explicit non-Trash destination", async () => {
  const api = mutationApi();
  const onChanged = vi.fn();
  const snapshot = {
    ...mutationSnapshot,
    groups: [
      { ...group(0), childGroupIds: ["group-child", "group-destination"] },
      group(1),
      {
        id: "group-destination",
        name: "Destination",
        childGroupIds: [],
        entryIds: [],
      },
    ],
  };
  render(
    <GroupActions
      api={api}
      group={group(1)}
      snapshot={snapshot}
      disabled={false}
      onChanged={onChanged}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Group actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Move group" }));
  fireEvent.change(screen.getByLabelText("Destination parent"), {
    target: { value: "group-destination" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => {
    expect(api.moveGroup).toHaveBeenCalledWith(
      "group-child",
      "group-destination",
    );
  });
  expect(onChanged).toHaveBeenCalledWith(mutationSnapshot, "group-child");
});

test("normal group subtree moves to Trash and falls back to its parent", async () => {
  const api = mutationApi();
  const onChanged = vi.fn();
  render(
    <GroupActions
      api={api}
      group={group(1)}
      snapshot={mutationSnapshot}
      disabled={false}
      onChanged={onChanged}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Group actions" }));
  expect(
    screen.queryByRole("menuitem", { name: "Delete permanently" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Move group to Trash" }),
  );
  expect(screen.getByText(/descendants will move to Trash/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  await waitFor(() => {
    expect(api.deleteGroup).toHaveBeenCalledWith("group-child");
  });
  expect(onChanged).toHaveBeenCalledWith(mutationSnapshot, "group-root");
  expect(api.permanentlyDeleteGroup).not.toHaveBeenCalled();
});

test("recycled group can restore or be permanently deleted only inside Trash", async () => {
  const recycledSnapshot = {
    ...mutationSnapshot,
    recycleBinGroupId: "group-trash",
    groups: [
      {
        ...group(0),
        childGroupIds: ["group-trash"],
      },
      {
        id: "group-trash",
        name: "Recycle Bin",
        childGroupIds: ["group-child"],
        entryIds: [],
      },
      group(1),
    ],
  };
  const api = mutationApi({
    restoreGroup: vi.fn().mockResolvedValue(mutationSnapshot),
    permanentlyDeleteGroup: vi.fn().mockResolvedValue(recycledSnapshot),
  });
  const onChanged = vi.fn();
  const { rerender } = render(
    <GroupActions
      api={api}
      group={group(1)}
      snapshot={recycledSnapshot}
      disabled={false}
      onChanged={onChanged}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Group actions" }));
  expect(
    screen.queryByRole("menuitem", { name: "Move group" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "Restore group" }));
  await waitFor(() => {
    expect(api.restoreGroup).toHaveBeenCalledWith("group-child");
  });
  expect(onChanged).toHaveBeenCalledWith(mutationSnapshot, "group-child");

  rerender(
    <GroupActions
      api={api}
      group={group(1)}
      snapshot={recycledSnapshot}
      disabled={false}
      onChanged={onChanged}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Group actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete permanently" }));
  expect(screen.getByText(/records deletion tombstones/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => {
    expect(api.permanentlyDeleteGroup).toHaveBeenCalledWith("group-child");
  });
  expect(onChanged).toHaveBeenLastCalledWith(recycledSnapshot, "group-trash");
});

test("group Trash action is absent when recycle bin is disabled", () => {
  render(
    <GroupActions
      api={mutationApi()}
      group={group(1)}
      snapshot={{ ...mutationSnapshot, recycleBinEnabled: false }}
      disabled={false}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Group actions" }));
  expect(
    screen.queryByRole("menuitem", { name: "Move group to Trash" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "Delete permanently" }),
  ).not.toBeInTheDocument();
});
