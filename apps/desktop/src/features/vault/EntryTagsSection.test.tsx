import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { mutationApi, mutationSnapshot } from "../../test/desktop-api";
import { EntryTagsSection } from "./EntryTagsSection";

afterEach(cleanup);

test("tag editing applies one exact ordered tag set through the semantic API", async () => {
  const setEntryTags = vi.fn().mockResolvedValue(mutationSnapshot);
  const onSnapshot = vi.fn();
  render(
    <EntryTagsSection
      api={mutationApi({ setEntryTags })}
      entryId="entry-a"
      tags={["work", "legacy"]}
      disabled={false}
      onSnapshot={onSnapshot}
      onDraftChange={vi.fn()}
      onBusyChange={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove tag legacy" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New tag" }), {
    target: { value: "personal" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply tags" }));

  await waitFor(() => {
    expect(setEntryTags).toHaveBeenCalledWith("entry-a", ["work", "personal"]);
  });
  expect(onSnapshot).toHaveBeenCalledWith(mutationSnapshot);
  expect(screen.getByRole("button", { name: "Edit tags" })).toBeVisible();
});

test("tag editor rejects exact duplicates and UTF-8 values beyond the reviewed bound", () => {
  render(
    <EntryTagsSection
      api={mutationApi()}
      entryId="entry-a"
      tags={["work"]}
      disabled={false}
      onSnapshot={vi.fn()}
      onDraftChange={vi.fn()}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
  const input = screen.getByRole("textbox", { name: "New tag" });

  fireEvent.change(input, { target: { value: "work" } });
  expect(screen.getByText("That exact tag already exists.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

  fireEvent.change(input, { target: { value: "é".repeat(129) } });
  expect(
    screen.getByText("A tag can contain at most 256 UTF-8 bytes."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
});

test("tag update failure keeps the draft available for retry", async () => {
  const setEntryTags = vi.fn().mockRejectedValue(new Error("synthetic"));
  render(
    <EntryTagsSection
      api={mutationApi({ setEntryTags })}
      entryId="entry-a"
      tags={[]}
      disabled={false}
      onSnapshot={vi.fn()}
      onDraftChange={vi.fn()}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New tag" }), {
    target: { value: "retry" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply tags" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not update tags",
  );
  expect(screen.getByText("retry")).toBeVisible();
});
