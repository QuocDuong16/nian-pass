import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { mutationApi, mutationSnapshot } from "../../test/desktop-api";
import { UnlockedView } from "./UnlockedView";

afterEach(cleanup);

function renderView() {
  const api = mutationApi();
  const onSnapshot = vi.fn();
  render(
    <UnlockedView
      api={api}
      snapshot={mutationSnapshot}
      locking={false}
      lockError={null}
      onSnapshot={onSnapshot}
      onLock={vi.fn()}
    />,
  );
  return { api, onSnapshot };
}

test("create dialog clears local drafts on Cancel and selects a successful creation", async () => {
  const { api, onSnapshot } = renderView();
  fireEvent.click(screen.getByRole("button", { name: "New entry" }));
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "draft-user" },
  });
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "m4.3://draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add notes" }));
  fireEvent.change(screen.getByLabelText("Notes"), {
    target: { value: "draft secret notes" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(api.createEntry).not.toHaveBeenCalled();
  expect(screen.queryByText("draft secret notes")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "New entry" }));
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Created" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create entry" }));
  await waitFor(() => {
    expect(onSnapshot).toHaveBeenCalledWith(mutationSnapshot);
  });
  expect(api.getEntryDetail).toHaveBeenCalledWith("entry-created");
});

test("parent selection callbacks follow canonical group, move, and delete results", async () => {
  const { api, onSnapshot } = renderView();
  fireEvent.click(screen.getByRole("button", { name: "New group" }));
  fireEvent.change(screen.getByLabelText("Group name"), {
    target: { value: "Child two" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => {
    expect(onSnapshot).toHaveBeenCalledWith(mutationSnapshot);
  });

  fireEvent.click(screen.getByRole("button", { name: /Account A/ }));
  await screen.findByRole("button", { name: "Move entry" });
  fireEvent.click(screen.getByRole("button", { name: "Move entry" }));
  fireEvent.change(screen.getByLabelText("Destination group"), {
    target: { value: "group-child" },
  });
  const move = screen.getAllByRole("button", { name: "Move entry" }).at(-1);
  if (move === undefined) throw new Error("move action missing");
  fireEvent.click(move);
  await waitFor(() => {
    expect(api.moveEntry).toHaveBeenCalledWith("entry-a", "group-child");
  });
});

test("entry deletion clears the parent selection after Rust succeeds", async () => {
  const { api } = renderView();
  fireEvent.click(screen.getByRole("button", { name: /Account A/ }));
  await screen.findByRole("button", { name: "Permanently delete entry" });
  fireEvent.click(
    screen.getByRole("button", { name: "Permanently delete entry" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Permanently delete$/ }));
  await waitFor(() => {
    expect(api.deleteEntry).toHaveBeenCalledWith("entry-a");
  });
  expect(
    screen.getByText("Select an entry to view its safe details."),
  ).toBeVisible();
});
