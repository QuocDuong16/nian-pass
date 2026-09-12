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

test("recursive group deletion warning is explicit and falls back to parent", async () => {
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
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Permanently delete group" }),
  );
  expect(screen.getByText(/every descendant group/)).toBeVisible();
  expect(
    screen.getByText(/Deletion tombstones will be recorded/),
  ).toBeVisible();
  const confirmDelete = screen
    .getAllByRole("button", { name: "Permanently delete group" })
    .at(-1);
  if (confirmDelete === undefined)
    throw new Error("delete confirmation missing");
  fireEvent.click(confirmDelete);
  await waitFor(() => {
    expect(api.deleteGroup).toHaveBeenCalledWith("group-child");
  });
  expect(onChanged).toHaveBeenCalledWith(mutationSnapshot, "group-root");
});
