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
  const onSave = vi.fn();
  render(
    <UnlockedView
      api={api}
      snapshot={mutationSnapshot}
      disabled={false}
      saveStatus="idle"
      lockError={null}
      onSnapshot={onSnapshot}
      onSave={onSave}
      onLock={vi.fn()}
    />,
  );
  return { api, onSnapshot, onSave };
}

test("Save is unavailable while an entry or creation draft is open", async () => {
  renderView();
  const save = screen.getByRole("button", { name: "Save vault" });
  expect(save).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "+ New entry" }));
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(save).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: /Account A/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit entry" }));
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(save).toBeEnabled();
});

test("create dialog clears local drafts on Cancel and selects a successful creation", async () => {
  const { api, onSnapshot } = renderView();
  fireEvent.click(screen.getByRole("button", { name: "+ New entry" }));
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

  fireEvent.click(screen.getByRole("button", { name: "+ New entry" }));
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Created" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create entry" }));
  await waitFor(() => {
    expect(onSnapshot).toHaveBeenCalledWith(mutationSnapshot);
  });
  await waitFor(() => {
    expect(api.getEntryDetail).toHaveBeenCalledWith("entry-created");
  });
});

test("parent selection callbacks follow canonical group, move, and delete results", async () => {
  const { api, onSnapshot } = renderView();
  fireEvent.click(screen.getByRole("button", { name: "Group actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "New group" }));
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

test("global search matches safe metadata and Escape restores the selected group", () => {
  const firstEntry = mutationSnapshot.entries[0];
  if (firstEntry === undefined) throw new Error("fixture entry missing");
  const snapshot = {
    ...mutationSnapshot,
    entries: [
      {
        ...firstEntry,
        title: { kind: "protected" as const },
        tags: ["Finance"],
      },
    ],
  };
  render(
    <UnlockedView
      api={mutationApi()}
      snapshot={snapshot}
      disabled={false}
      saveStatus="idle"
      lockError={null}
      onSnapshot={vi.fn()}
      onSave={vi.fn()}
      onLock={vi.fn()}
    />,
  );

  const search = screen.getByRole("searchbox", { name: "Search vault" });
  fireEvent.change(search, { target: { value: "finance" } });
  expect(screen.getByRole("heading", { name: "Search results" })).toBeVisible();
  expect(screen.getByText("1 results")).toBeVisible();

  fireEvent.change(search, { target: { value: "root" } });
  expect(screen.getByText("1 results")).toBeVisible();
  fireEvent.keyDown(search, { key: "Escape" });
  expect(screen.getByRole("heading", { name: "Root" })).toBeVisible();
});

test("search shortcut focuses the vault search and Settings closes on Escape", () => {
  renderView();
  const search = screen.getByRole("searchbox", { name: "Search vault" });

  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(search).toHaveFocus();

  const settings = screen.getByRole("button", { name: "Settings" });
  settings.focus();
  fireEvent.click(settings);
  expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();

  fireEvent.keyDown(window, { key: "k", metaKey: true });
  expect(search).not.toHaveFocus();

  fireEvent.keyDown(window, { key: "Escape" });
  expect(
    screen.queryByRole("dialog", { name: "Settings" }),
  ).not.toBeInTheDocument();

  fireEvent.keyDown(window, { key: "K", metaKey: true });
  expect(search).toHaveFocus();
});

test("Save shortcut runs only when the vault surface is actionable", () => {
  const { onSave } = renderView();
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  expect(onSave).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
  fireEvent.keyDown(window, { key: "S", metaKey: true });
  expect(onSave).toHaveBeenCalledOnce();
});

test.each([
  ["unsupported_write_format", "Read-only in Nian Pass"],
  ["unsupported_persistence_platform", "Read-only on this platform"],
  ["read_only_source", "Read-only source"],
] as const)(
  "%s capability disables mutation and explains why",
  (restriction, message) => {
    const snapshot = {
      ...mutationSnapshot,
      capabilities: {
        ...mutationSnapshot.capabilities,
        writable: false,
        writeRestriction: restriction,
      },
    };
    render(
      <UnlockedView
        api={mutationApi()}
        snapshot={snapshot}
        disabled={false}
        saveStatus="idle"
        lockError={null}
        onSnapshot={vi.fn()}
        onSave={vi.fn()}
        onLock={vi.fn()}
      />,
    );

    expect(screen.getByText(new RegExp(message, "i"))).toBeVisible();
    expect(screen.getByRole("button", { name: "Save vault" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ New entry" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Group actions" }),
    ).toBeDisabled();
  },
);
