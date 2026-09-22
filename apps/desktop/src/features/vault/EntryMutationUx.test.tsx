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

test("entry built-in icon is applied atomically while an unchanged icon is omitted", async () => {
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

  expect(screen.getByLabelText<HTMLSelectElement>("Icon").value).toBe("none");
  fireEvent.change(screen.getByLabelText("Icon"), {
    target: { value: "built_in:68" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));

  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledWith({
      entryId: "entry-a",
      title: "Account A",
      username: "user-a",
      url: "m4.3://a",
      icon: { kind: "built_in", id: 68 },
    });
  });
});

test("custom icon stays untouched until the user explicitly replaces or clears it", async () => {
  const api = mutationApi();
  const { rerender } = render(
    <EntryEditForm
      api={api}
      detail={{ ...mutationDetail, icon: { kind: "custom" } }}
      disabled={false}
      onApplied={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  const icon = screen.getByLabelText<HTMLSelectElement>("Icon");
  expect(icon.value).toBe("preserve");
  expect(icon).toHaveTextContent("Keep current: Custom icon");
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledOnce();
  });
  expect(api.updateEntry).toHaveBeenLastCalledWith({
    entryId: "entry-a",
    title: "Account A",
    username: "user-a",
    url: "m4.3://a",
  });

  vi.mocked(api.updateEntry).mockClear();
  rerender(
    <EntryEditForm
      api={api}
      detail={{ ...mutationDetail, icon: { kind: "custom" } }}
      disabled={false}
      onApplied={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Icon"), {
    target: { value: "none" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledWith({
      entryId: "entry-a",
      title: "Account A",
      username: "user-a",
      url: "m4.3://a",
      icon: { kind: "none" },
    });
  });
});

test("entry expiry validates locally and is applied atomically with metadata", async () => {
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

  expect(
    screen.getByRole("checkbox", { name: "Entry expires" }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Entry expires" }));
  expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Choose a valid expiry");

  const localExpiry = "2030-01-02T03:04";
  fireEvent.change(screen.getByLabelText("Expiry date and time"), {
    target: { value: localExpiry },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));

  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledWith({
      entryId: "entry-a",
      title: "Account A",
      username: "user-a",
      url: "m4.3://a",
      expires: true,
      expiryUnixSeconds: Math.floor(new Date(localExpiry).getTime() / 1000),
    });
  });
});

test("entry expiry can be disabled without sending a stale timestamp", async () => {
  const api = mutationApi();
  render(
    <EntryEditForm
      api={api}
      detail={{ ...mutationDetail, expiresAtUnixSeconds: 1_893_456_000 }}
      disabled={false}
      onApplied={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByRole("checkbox", { name: "Entry expires" })).toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Entry expires" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));

  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledWith({
      entryId: "entry-a",
      title: "Account A",
      username: "user-a",
      url: "m4.3://a",
      expires: false,
    });
  });
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

test("passphrase generation changes only the edit draft until explicit Apply", async () => {
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
  fireEvent.click(screen.getByRole("button", { name: "Passphrase" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  const password = screen.getByLabelText<HTMLInputElement>("Password");
  expect(password).toHaveAttribute("type", "password");
  expect(password.value.split("-")).toHaveLength(6);
  expect(api.updateEntry).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ password: password.value }),
    );
  });
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
});

test("passphrase creation sends plaintext only on explicit Create", async () => {
  const api = mutationApi();
  render(
    <EntryCreateDialog
      api={api}
      groupId="group-root"
      onCreated={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Passphrase entry" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate password" }));
  fireEvent.click(screen.getByRole("button", { name: "Passphrase" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  const password = screen.getByLabelText<HTMLInputElement>("Password");
  expect(password.value.split("-")).toHaveLength(6);
  const generated = password.value;
  expect(api.createEntry).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Create entry" }));
  await waitFor(() => {
    expect(api.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ password: generated }),
    );
  });
  expect(screen.queryByDisplayValue(generated)).not.toBeInTheDocument();
});

test("entry creation Escape cancels the local draft", () => {
  const onCancel = vi.fn();
  render(
    <EntryCreateDialog
      api={mutationApi()}
      groupId="group-root"
      onCreated={vi.fn()}
      onCancel={onCancel}
    />,
  );

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();
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

test("protected and unprotected custom fields copy without revealing plaintext", async () => {
  const api = mutationApi();
  render(
    <CustomFieldsEditor
      api={api}
      entryId="entry-a"
      fields={[
        { name: "Private", protection: "protected" },
        { name: "Region", protection: "unprotected" },
      ]}
      disabled={false}
      onApplied={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Copy Private" }));
  await waitFor(() => {
    expect(api.copyEntryCustomField).toHaveBeenCalledWith("entry-a", "Private");
  });
  expect(api.revealEntryCustomField).not.toHaveBeenCalled();
  expect(document.body).not.toHaveTextContent("custom secret");

  const regionCopy = screen.getByRole("button", { name: "Copy Region" });
  await waitFor(() => {
    expect(regionCopy).not.toBeDisabled();
  });
  fireEvent.click(regionCopy);
  await waitFor(() => {
    expect(api.copyEntryCustomField).toHaveBeenCalledWith("entry-a", "Region");
  });
  expect(api.revealEntryCustomField).not.toHaveBeenCalled();
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

test("entry duplicate uses the semantic API without revealing secrets", async () => {
  const duplicateEntry = vi.fn().mockResolvedValue({
    createdEntryId: "entry-duplicate",
    snapshot: mutationSnapshot,
  });
  const api = mutationApi({ duplicateEntry });
  const onDuplicated = vi.fn();
  render(
    <EntryActions
      api={api}
      detail={mutationDetail}
      groups={mutationSnapshot.groups}
      disabled={false}
      onDeleted={vi.fn()}
      onDuplicated={onDuplicated}
      onMoved={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Duplicate entry" }));
  await waitFor(() => {
    expect(duplicateEntry).toHaveBeenCalledWith("entry-a");
  });
  expect(api.revealEntryPassword).not.toHaveBeenCalled();
  expect(api.revealEntryNotes).not.toHaveBeenCalled();
  expect(onDuplicated).toHaveBeenCalledWith({
    createdEntryId: "entry-duplicate",
    snapshot: mutationSnapshot,
  });
});

test("entry duplicate failure stays local and reports a generic error", async () => {
  const api = mutationApi({
    duplicateEntry: vi
      .fn()
      .mockRejectedValue(new Error("synthetic duplicate failure")),
  });
  render(
    <EntryActions
      api={api}
      detail={mutationDetail}
      groups={mutationSnapshot.groups}
      disabled={false}
      onDeleted={vi.fn()}
      onDuplicated={vi.fn()}
      onMoved={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Duplicate entry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not complete the entry operation",
  );
});

test("normal entry moves to Trash instead of permanent deletion and still moves by GroupId", async () => {
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

  expect(
    screen.queryByRole("button", { name: "Permanently delete entry" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Move entry to Trash" }));
  expect(screen.getByText(/can be restored later/)).toBeVisible();
  expect(
    screen.getByText(/without creating a deletion tombstone/),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm move entry to Trash" }),
  );
  await waitFor(() => {
    expect(api.deleteEntry).toHaveBeenCalledWith("entry-a");
  });
  expect(onDeleted).toHaveBeenCalledWith(mutationSnapshot);
  expect(api.permanentlyDeleteEntry).not.toHaveBeenCalled();

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

test("recycled entry can restore or be permanently deleted only from Trash", async () => {
  const api = mutationApi();
  const onDeleted = vi.fn();
  const onMoved = vi.fn();
  const { rerender } = render(
    <EntryActions
      api={api}
      detail={mutationDetail}
      groups={mutationSnapshot.groups}
      disabled={false}
      recycled
      onDeleted={onDeleted}
      onMoved={onMoved}
    />,
  );

  expect(
    screen.queryByRole("button", { name: "Move entry" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Restore entry" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Permanently delete entry" }),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Restore entry" }));
  await waitFor(() => {
    expect(api.restoreEntry).toHaveBeenCalledWith("entry-a");
  });
  expect(onMoved).toHaveBeenCalledWith(mutationSnapshot, "group-root");

  rerender(
    <EntryActions
      api={api}
      detail={mutationDetail}
      groups={mutationSnapshot.groups}
      disabled={false}
      recycled
      onDeleted={onDeleted}
      onMoved={onMoved}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Permanently delete entry" }),
  );
  expect(screen.getByText(/records a deletion tombstone/)).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm permanent entry deletion" }),
  );
  await waitFor(() => {
    expect(api.permanentlyDeleteEntry).toHaveBeenCalledWith("entry-a");
  });
  expect(onDeleted).toHaveBeenCalledWith(mutationSnapshot);
});

test("entry Trash action is absent when the database explicitly disables recycle bin", () => {
  render(
    <EntryActions
      api={mutationApi()}
      detail={mutationDetail}
      groups={mutationSnapshot.groups}
      disabled={false}
      recycleBinEnabled={false}
      onDeleted={vi.fn()}
      onMoved={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Move entry to Trash" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Permanently delete entry" }),
  ).not.toBeInTheDocument();
});
