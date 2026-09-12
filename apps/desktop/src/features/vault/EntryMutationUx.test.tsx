import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  mutationApi,
  mutationDetail,
  mutationSnapshot,
} from "../../test/desktop-api";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { EntryActions } from "./EntryActions";
import { EntryCreateDialog } from "./EntryCreateDialog";
import { EntryEditForm } from "./EntryEditForm";

afterEach(cleanup);

test("entry edit never preloads the old password and Cancel discards drafts", () => {
  const api = mutationApi();
  const onCancel = vi.fn();
  render(
    <EntryEditForm
      api={api}
      detail={mutationDetail}
      disabled={false}
      onApplied={vi.fn()}
      onCancel={onCancel}
    />,
  );

  expect(screen.queryByDisplayValue("old-password")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "M4.3-NEW-PASSWORD" },
  });
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "draft title" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onCancel).toHaveBeenCalledOnce();
  expect(api.updateEntry).not.toHaveBeenCalled();
  expect(
    screen.queryByDisplayValue("M4.3-NEW-PASSWORD"),
  ).not.toBeInTheDocument();
});

test("one Apply sends intentional fields and clears password and notes drafts", async () => {
  const api = mutationApi();
  const onApplied = vi.fn();
  render(
    <EntryEditForm
      api={api}
      detail={mutationDetail}
      disabled={false}
      onApplied={onApplied}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Updated A" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "M4.3-NEW-PASSWORD" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Load notes for editing" }),
  );
  expect(await screen.findByDisplayValue("secret notes")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Notes"), {
    target: { value: "M4.3-NEW-NOTES" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));

  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledWith({
      entryId: "entry-a",
      title: "Updated A",
      username: "user-a",
      url: "m4.3://a",
      password: "M4.3-NEW-PASSWORD",
      notes: "M4.3-NEW-NOTES",
    });
  });
  expect(onApplied).toHaveBeenCalledWith(mutationSnapshot);
  expect(
    screen.queryByDisplayValue("M4.3-NEW-PASSWORD"),
  ).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("M4.3-NEW-NOTES")).not.toBeInTheDocument();
});

test("entry edit failure clears secret drafts while retaining non-secret metadata", async () => {
  const api = mutationApi({
    updateEntry: vi.fn().mockRejectedValue(new Error("synthetic")),
  });
  render(
    <EntryEditForm
      api={api}
      detail={mutationDetail}
      disabled={false}
      onApplied={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "keep draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "M4.3-FAIL-PASSWORD" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not update",
  );
  expect(screen.getByDisplayValue("keep draft")).toBeVisible();
  expect(
    screen.queryByDisplayValue("M4.3-FAIL-PASSWORD"),
  ).not.toBeInTheDocument();
});

test("entry edit password generator keeps generated plaintext in the local draft", () => {
  const api = mutationApi();
  render(
    <EntryEditForm
      api={api}
      detail={mutationDetail}
      disabled={false}
      onApplied={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Generate password" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  const password = screen.getByLabelText<HTMLInputElement>("Password");
  expect(password.value).not.toBe("");
  expect(api.updateEntry).not.toHaveBeenCalled();
});

test("entry creation password generator materializes only the new local password field", () => {
  const api = mutationApi();
  render(
    <EntryCreateDialog
      api={api}
      groupId="group-root"
      onCreated={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Generate password" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  const password = screen.getByLabelText<HTMLInputElement>("Password");
  expect(password.value).not.toBe("");
  expect(api.createEntry).not.toHaveBeenCalled();
});

test("entry creation keeps secrets local, selects result, and clears on failure or Cancel", async () => {
  const api = mutationApi();
  const onCreated = vi.fn();
  const { rerender } = render(
    <EntryCreateDialog
      api={api}
      groupId="group-root"
      onCreated={onCreated}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Created" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add password" }));
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "M4.3-CREATE-PASSWORD" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create entry" }));
  await waitFor(() => {
    expect(onCreated).toHaveBeenCalledOnce();
  });
  expect(api.createEntry).toHaveBeenCalledWith({
    groupId: "group-root",
    title: "Created",
    username: "",
    url: "",
    password: "M4.3-CREATE-PASSWORD",
    notes: null,
  });
  expect(
    screen.queryByDisplayValue("M4.3-CREATE-PASSWORD"),
  ).not.toBeInTheDocument();

  const failed = mutationApi({
    createEntry: vi.fn().mockRejectedValue(new Error("fail")),
  });
  rerender(
    <EntryCreateDialog
      api={failed}
      groupId="group-root"
      onCreated={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add password" }));
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "FAIL" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create entry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not create",
  );
  expect(screen.queryByDisplayValue("FAIL")).not.toBeInTheDocument();
});

test("custom field edit is explicit, preserves protection, and ignores a late load", async () => {
  let resolveValue: (value: string) => void = () => undefined;
  const pending = new Promise<string>((resolve) => {
    resolveValue = resolve;
  });
  const api = mutationApi({
    revealEntryCustomField: vi.fn().mockReturnValue(pending),
  });
  const view = render(
    <CustomFieldsEditor
      api={api}
      entryId="entry-a"
      fields={mutationDetail.customFields}
      disabled={false}
      onApplied={vi.fn()}
    />,
  );
  expect(document.body).not.toHaveTextContent("custom secret");
  fireEvent.click(screen.getByRole("button", { name: "Edit Private" }));
  expect(api.revealEntryCustomField).toHaveBeenCalledWith("entry-a", "Private");
  view.unmount();
  await act(async () => {
    resolveValue("M4.3-LATE-CUSTOM");
    await pending;
  });
  expect(document.body).not.toHaveTextContent("M4.3-LATE-CUSTOM");

  const immediate = mutationApi();
  render(
    <CustomFieldsEditor
      api={immediate}
      entryId="entry-a"
      fields={mutationDetail.customFields}
      disabled={false}
      onApplied={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit Private" }));
  expect(await screen.findByDisplayValue("custom secret")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "updated custom" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => {
    expect(immediate.setEntryCustomField).toHaveBeenCalledWith({
      entryId: "entry-a",
      name: "Private",
      value: "updated custom",
      protection: "protected",
    });
  });
});

test("custom field load failure cannot mutate and leaves Apply disabled", async () => {
  const api = mutationApi({
    revealEntryCustomField: vi.fn().mockRejectedValue(new Error("synthetic")),
  });
  render(
    <CustomFieldsEditor
      api={api}
      entryId="entry-a"
      fields={mutationDetail.customFields}
      disabled={false}
      onApplied={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit Private" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load this custom field value",
  );
  const apply = screen.getByRole("button", { name: "Apply" });
  expect(apply).toBeDisabled();
  fireEvent.click(apply);
  expect(api.setEntryCustomField).not.toHaveBeenCalled();
});

test("custom field retry loads the value before permitting mutation", async () => {
  const api = mutationApi({
    revealEntryCustomField: vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic"))
      .mockResolvedValueOnce("custom secret"),
  });
  render(
    <CustomFieldsEditor
      api={api}
      entryId="entry-a"
      fields={mutationDetail.customFields}
      disabled={false}
      onApplied={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit Private" }));
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: "Retry loading custom field value" }),
  );
  expect(await screen.findByDisplayValue("custom secret")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "updated secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => {
    expect(api.setEntryCustomField).toHaveBeenCalledWith({
      entryId: "entry-a",
      name: "Private",
      value: "updated secret",
      protection: "protected",
    });
  });
});

test("loaded empty existing custom value remains a legitimate editable value", async () => {
  const api = mutationApi({
    revealEntryCustomField: vi.fn().mockResolvedValue(""),
  });
  render(
    <CustomFieldsEditor
      api={api}
      entryId="entry-a"
      fields={mutationDetail.customFields}
      disabled={false}
      onApplied={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit Private" }));
  const textarea = await screen.findByLabelText("Value");
  expect(textarea).toHaveValue("");
  const apply = screen.getByRole("button", { name: "Apply" });
  expect(apply).toBeEnabled();
  fireEvent.click(apply);
  await waitFor(() => {
    expect(api.setEntryCustomField).toHaveBeenCalledWith({
      entryId: "entry-a",
      name: "Private",
      value: "",
      protection: "protected",
    });
  });
});

test("custom field add chooses protection and delete failures clear value state", async () => {
  const api = mutationApi({
    deleteEntryCustomField: vi.fn().mockRejectedValue(new Error("synthetic")),
  });
  render(
    <CustomFieldsEditor
      api={api}
      entryId="entry-a"
      fields={mutationDetail.customFields}
      disabled={false}
      onApplied={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Add custom field" }));
  fireEvent.change(screen.getByLabelText("Field name"), {
    target: { value: "Public value" },
  });
  fireEvent.change(screen.getByLabelText("Protection"), {
    target: { value: "unprotected" },
  });
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "M4.3-CUSTOM-DRAFT" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => {
    expect(api.setEntryCustomField).toHaveBeenCalledWith({
      entryId: "entry-a",
      name: "Public value",
      value: "M4.3-CUSTOM-DRAFT",
      protection: "unprotected",
    });
  });

  fireEvent.click(screen.getByRole("button", { name: "Add custom field" }));
  fireEvent.change(screen.getByLabelText("Field name"), {
    target: { value: "Protected value" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => {
    expect(api.setEntryCustomField).toHaveBeenLastCalledWith({
      entryId: "entry-a",
      name: "Protected value",
      value: "",
      protection: "protected",
    });
  });

  fireEvent.click(screen.getByRole("button", { name: "Delete Private" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete field" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not change",
  );
  expect(api.deleteEntryCustomField).toHaveBeenCalledWith("entry-a", "Private");
});

test("existing unnamed custom field remains editable and deletable by its exact key", async () => {
  const api = mutationApi();
  render(
    <CustomFieldsEditor
      api={api}
      entryId="entry-a"
      fields={[{ name: "", protection: "protected" }]}
      disabled={false}
      onApplied={vi.fn()}
    />,
  );
  expect(screen.getByText("Unnamed custom field")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit unnamed custom field" }),
  );
  expect(await screen.findByDisplayValue("custom secret")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "updated unnamed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => {
    expect(api.setEntryCustomField).toHaveBeenCalledWith({
      entryId: "entry-a",
      name: "",
      value: "updated unnamed",
      protection: "protected",
    });
  });

  fireEvent.click(
    screen.getByRole("button", { name: "Delete unnamed custom field" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete field" }));
  await waitFor(() => {
    expect(api.deleteEntryCustomField).toHaveBeenCalledWith("entry-a", "");
  });
});

test("notes load failure is visible and omits notes from metadata update", async () => {
  const api = mutationApi({
    revealEntryNotes: vi.fn().mockRejectedValue(new Error("synthetic")),
  });
  render(
    <EntryEditForm
      api={api}
      detail={mutationDetail}
      disabled={false}
      onApplied={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Updated without notes" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Load notes for editing" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load notes for editing",
  );
  expect(
    screen.getByRole("button", { name: "Retry loading notes" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledOnce();
  });
  const request = vi.mocked(api.updateEntry).mock.calls[0]?.[0];
  expect(request).toMatchObject({
    entryId: "entry-a",
    title: "Updated without notes",
  });
  expect(request).not.toHaveProperty("notes");
});

test("protected metadata enters the edit draft only after explicit load", async () => {
  const api = mutationApi();
  render(
    <EntryEditForm
      api={api}
      detail={{ ...mutationDetail, title: { kind: "protected" } }}
      disabled={false}
      onApplied={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.queryByDisplayValue("protected title")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load protected Title" }));
  expect(await screen.findByDisplayValue("protected title")).toBeVisible();
  expect(api.revealEntryTitle).toHaveBeenCalledWith("entry-a");
});

test("entry destructive dialogs explain permanent deletion and move by GroupId", async () => {
  const api = mutationApi();
  const onDeleted = vi.fn();
  const onMoved = vi.fn();
  render(
    <EntryActions
      api={api}
      detail={mutationDetail}
      groups={mutationSnapshot.groups}
      disabled={false}
      onDeleted={onDeleted}
      onMoved={onMoved}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Permanently delete entry" }),
  );
  expect(screen.getByText(/records a deletion tombstone/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(api.deleteEntry).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Move entry" }));
  fireEvent.change(screen.getByLabelText("Destination group"), {
    target: { value: "group-child" },
  });
  const confirmMove = screen
    .getAllByRole("button", { name: "Move entry" })
    .at(-1);
  if (confirmMove === undefined) throw new Error("move confirmation missing");
  fireEvent.click(confirmMove);
  await waitFor(() => {
    expect(api.moveEntry).toHaveBeenCalledWith("entry-a", "group-child");
  });
  expect(onMoved).toHaveBeenCalledWith(mutationSnapshot, "group-child");
});
