import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { mutationApi, mutationSnapshot } from "../../test/desktop-api";
import type { EntrySummaryDto } from "../../types/desktop";
import { VaultEntryPane } from "./VaultEntryPane";

afterEach(cleanup);

const firstEntry = mutationSnapshot.entries[0];
if (firstEntry === undefined) throw new Error("fixture entry missing");

const secondEntry: EntrySummaryDto = {
  ...firstEntry,
  id: "entry-b",
  title: { kind: "visible", value: "Account B" },
  username: { kind: "visible", value: "user-b" },
};

const entries = [firstEntry, secondEntry];
const firstGroup = mutationSnapshot.groups[0];
if (firstGroup === undefined) throw new Error("fixture group missing");
const group = {
  ...firstGroup,
  entryIds: entries.map((entry) => entry.id),
};
const activeGroups = mutationSnapshot.groups;

function renderPane(
  overrides: {
    moveEntries?: import("../../lib/desktop").DesktopApi["moveEntries"];
    trashEntries?: import("../../lib/desktop").DesktopApi["trashEntries"];
    restoreEntries?: import("../../lib/desktop").DesktopApi["restoreEntries"];
    permanentlyDeleteEntries?: import("../../lib/desktop").DesktopApi["permanentlyDeleteEntries"];
    searchActive?: boolean;
    recycled?: boolean;
    recycleBinEnabled?: boolean;
  } = {},
) {
  const moveEntries =
    overrides.moveEntries ??
    vi
      .fn<import("../../lib/desktop").DesktopApi["moveEntries"]>()
      .mockResolvedValue(mutationSnapshot);
  const trashEntries =
    overrides.trashEntries ??
    vi
      .fn<import("../../lib/desktop").DesktopApi["trashEntries"]>()
      .mockResolvedValue(mutationSnapshot);
  const restoreEntries =
    overrides.restoreEntries ??
    vi
      .fn<import("../../lib/desktop").DesktopApi["restoreEntries"]>()
      .mockResolvedValue(mutationSnapshot);
  const permanentlyDeleteEntries =
    overrides.permanentlyDeleteEntries ??
    vi
      .fn<import("../../lib/desktop").DesktopApi["permanentlyDeleteEntries"]>()
      .mockResolvedValue(mutationSnapshot);
  const api = mutationApi({
    moveEntries,
    trashEntries,
    restoreEntries,
    permanentlyDeleteEntries,
  });
  const onSelectionStart = vi.fn();
  const onBusyChange = vi.fn();
  const onBulkChanged = vi.fn();
  const onSelectEntry = vi.fn();
  const onNewEntry = vi.fn();

  render(
    <VaultEntryPane
      api={api}
      group={group}
      entries={entries}
      activeGroups={activeGroups}
      selectedEntryId={null}
      searchActive={overrides.searchActive ?? false}
      disabled={false}
      bulkDisabled={false}
      recycled={overrides.recycled ?? false}
      recycleBinEnabled={overrides.recycleBinEnabled ?? true}
      onNewEntry={onNewEntry}
      onSelectEntry={onSelectEntry}
      onSelectionStart={onSelectionStart}
      onBusyChange={onBusyChange}
      onBulkChanged={onBulkChanged}
    />,
  );

  return {
    api,
    moveEntries,
    trashEntries,
    restoreEntries,
    permanentlyDeleteEntries,
    onSelectionStart,
    onBusyChange,
    onBulkChanged,
    onSelectEntry,
  };
}

test("entry sorting changes presentation only and stays out of bulk selection mode", () => {
  renderPane();

  const entryRows = () =>
    screen.getAllByRole("button", { name: /Account [AB]/ });
  expect(entryRows()[0]).toHaveTextContent("Account A");
  expect(entryRows()[1]).toHaveTextContent("Account B");

  const sort = screen.getByRole("combobox", { name: "Sort entries" });
  fireEvent.change(sort, { target: { value: "title_desc" } });
  expect(entryRows()[0]).toHaveTextContent("Account B");
  expect(entryRows()[1]).toHaveTextContent("Account A");

  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  expect(
    screen.queryByRole("combobox", { name: "Sort entries" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("checkbox")[0]).toHaveTextContent("Account B");

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("combobox", { name: "Sort entries" })).toHaveValue(
    "title_desc",
  );
  expect(entryRows()[0]).toHaveTextContent("Account B");
});

test("bulk move selects multiple rows and submits one atomic request", async () => {
  const { api, moveEntries, onSelectionStart, onBusyChange, onBulkChanged } =
    renderPane();

  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  expect(onSelectionStart).toHaveBeenCalledOnce();
  const first = screen.getByRole("checkbox", { name: /Account A/ });
  const second = screen.getByRole("checkbox", { name: /Account B/ });
  fireEvent.click(first);
  fireEvent.click(second);
  expect(first).toHaveAttribute("aria-checked", "true");
  expect(second).toHaveAttribute("aria-checked", "true");

  fireEvent.click(screen.getByRole("button", { name: "Move" }));
  const dialog = screen.getByRole("dialog", { name: "Move 2 entries" });
  fireEvent.change(within(dialog).getByLabelText("Destination group"), {
    target: { value: "group-child" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Move entries" }));

  await waitFor(() => {
    expect(moveEntries).toHaveBeenCalledTimes(1);
    expect(moveEntries).toHaveBeenCalledWith(
      ["entry-a", "entry-b"],
      "group-child",
    );
    expect(onBulkChanged).toHaveBeenCalledWith(mutationSnapshot, "group-child");
  });
  expect(api.moveEntry).not.toHaveBeenCalled();
  expect(onBusyChange).toHaveBeenNthCalledWith(1, true);
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

test("bulk Trash uses one command and never loops the single-entry delete API", async () => {
  const { api, trashEntries, onBulkChanged } = renderPane();

  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Account A/ }));
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  const dialog = screen.getByRole("dialog", { name: "Move 1 entry to Trash" });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Move to Trash" }),
  );

  await waitFor(() => {
    expect(trashEntries).toHaveBeenCalledTimes(1);
    expect(trashEntries).toHaveBeenCalledWith(["entry-a"]);
    expect(onBulkChanged).toHaveBeenCalledWith(mutationSnapshot, undefined);
  });
  expect(api.deleteEntry).not.toHaveBeenCalled();
});

test("Trash bulk actions restore or permanently delete through one command", async () => {
  const { api, restoreEntries, permanentlyDeleteEntries, onBulkChanged } =
    renderPane({ recycled: true });

  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Account A/ }));
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  const restoreDialog = screen.getByRole("dialog", { name: "Restore 1 entry" });
  fireEvent.click(
    within(restoreDialog).getByRole("button", { name: "Restore entries" }),
  );

  await waitFor(() => {
    expect(restoreEntries).toHaveBeenCalledWith(["entry-a"]);
    expect(onBulkChanged).toHaveBeenCalledWith(mutationSnapshot, undefined);
  });
  expect(api.restoreEntry).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Account B/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  const deleteDialog = screen.getByRole("dialog", {
    name: "Delete 1 entry permanently",
  });
  expect(
    within(deleteDialog).getByText(/cannot be undone/i),
  ).toBeInTheDocument();
  fireEvent.click(
    within(deleteDialog).getByRole("button", { name: "Delete permanently" }),
  );

  await waitFor(() => {
    expect(permanentlyDeleteEntries).toHaveBeenCalledWith(["entry-b"]);
    expect(onBulkChanged).toHaveBeenCalledTimes(2);
  });
  expect(api.permanentlyDeleteEntry).not.toHaveBeenCalled();
});

test("bulk failure keeps the selection and accepts no partial snapshot", async () => {
  const moveEntries = vi.fn().mockRejectedValue(new Error("failed"));
  const { onBulkChanged } = renderPane({ moveEntries });

  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Account A/ }));
  fireEvent.click(screen.getByRole("button", { name: "Move" }));
  const dialog = screen.getByRole("dialog", { name: "Move 1 entry" });
  fireEvent.change(within(dialog).getByLabelText("Destination group"), {
    target: { value: "group-child" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Move entries" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "No partial result was accepted",
  );
  expect(onBulkChanged).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("checkbox", { name: /Account A/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("bulk selection is unavailable in search or when mutations are blocked", () => {
  const { unmount } = render(
    <VaultEntryPane
      api={mutationApi()}
      group={group}
      entries={entries}
      activeGroups={activeGroups}
      selectedEntryId={null}
      searchActive
      disabled={false}
      bulkDisabled={false}
      recycleBinEnabled
      onNewEntry={vi.fn()}
      onSelectEntry={vi.fn()}
      onSelectionStart={vi.fn()}
      onBusyChange={vi.fn()}
      onBulkChanged={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Select" }),
  ).not.toBeInTheDocument();
  unmount();

  render(
    <VaultEntryPane
      api={mutationApi()}
      group={group}
      entries={entries}
      activeGroups={activeGroups}
      selectedEntryId={null}
      searchActive={false}
      disabled
      bulkDisabled
      recycled
      recycleBinEnabled
      onNewEntry={vi.fn()}
      onSelectEntry={vi.fn()}
      onSelectionStart={vi.fn()}
      onBusyChange={vi.fn()}
      onBulkChanged={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Select" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "+ New entry" }),
  ).not.toBeInTheDocument();
});
