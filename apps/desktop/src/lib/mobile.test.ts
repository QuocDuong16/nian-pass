import { afterEach, expect, test, vi } from "vitest";

import contract from "../../contracts/mobile-contract.json";
import { MobileCommandError, mobileApi, parseMobileErrorCode } from "./mobile";
import { parseEntryDetail } from "./entry-validation";
import {
  parseCreatedEntry,
  parseCreatedGroup,
  parseVaultSnapshot,
} from "./validation";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(() => {
  invoke.mockReset();
});

test("committed mobile contract passes exact runtime validation", () => {
  expect(contract.selectedVault).toEqual({
    fileName: "example.kdbx",
    writable: true,
  });
  expect(parseVaultSnapshot(contract.snapshot)).toEqual(contract.snapshot);
  expect(parseVaultSnapshot(contract.dirtySnapshot)).toEqual(
    contract.dirtySnapshot,
  );
  expect(parseCreatedEntry(contract.createdEntry)).toEqual(
    contract.createdEntry,
  );
  expect(parseCreatedGroup(contract.createdGroup)).toEqual(
    contract.createdGroup,
  );
  expect(parseEntryDetail(contract.entryDetail)).toEqual(contract.entryDetail);
  expect(contract.errors.map(parseMobileErrorCode)).toEqual(contract.errors);
});

test("autofill adapter accepts only secret-free exact-key contracts", async () => {
  invoke
    .mockResolvedValueOnce(contract.autofillStatus)
    .mockResolvedValueOnce({
      request: contract.autofillRequest,
      selectedVault: contract.selectedVault,
    })
    .mockResolvedValueOnce([contract.autofillCandidate])
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null);

  await expect(mobileApi.getAutofillStatus()).resolves.toEqual(
    contract.autofillStatus,
  );
  await expect(mobileApi.getAutofillRequest()).resolves.toEqual({
    request: contract.autofillRequest,
    selectedVault: contract.selectedVault,
  });
  await expect(
    mobileApi.getAutofillCandidates("opaque-request-token"),
  ).resolves.toEqual([contract.autofillCandidate]);
  await mobileApi.approveAutofill(
    "opaque-request-token",
    "entry-example",
    true,
  );
  await mobileApi.cancelAutofill("opaque-request-token");

  expect(invoke).toHaveBeenNthCalledWith(4, "mobile_autofill_approve", {
    requestToken: "opaque-request-token",
    entryId: "entry-example",
    approved: true,
  });
  expect(invoke).toHaveBeenNthCalledWith(5, "mobile_autofill_cancel", {
    requestToken: "opaque-request-token",
  });
});

test("autofill source and provider setup adapters remain semantic", async () => {
  invoke
    .mockResolvedValueOnce({
      ...contract.autofillStatus,
      sourceEnabled: true,
    })
    .mockResolvedValueOnce(contract.autofillStatus)
    .mockResolvedValueOnce(contract.autofillStatus)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null);

  await mobileApi.enableAutofill();
  await mobileApi.disableAutofill();
  await mobileApi.refreshAutofill();
  await mobileApi.publishAutofillCandidates("opaque-request-token");
  await mobileApi.openAutofillSettings();

  expect(invoke).toHaveBeenNthCalledWith(
    1,
    "mobile_enable_autofill_for_vault",
    undefined,
  );
  expect(invoke).toHaveBeenNthCalledWith(
    2,
    "mobile_disable_autofill_for_vault",
    undefined,
  );
  expect(invoke).toHaveBeenNthCalledWith(
    3,
    "mobile_refresh_ios_autofill_mirror",
    undefined,
  );
  expect(invoke).toHaveBeenNthCalledWith(
    4,
    "mobile_autofill_publish_candidates",
    { requestToken: "opaque-request-token" },
  );
  expect(invoke).toHaveBeenNthCalledWith(
    5,
    "mobile_open_autofill_settings",
    undefined,
  );
});

test("mobile adapter invokes semantic source and vault commands", async () => {
  invoke
    .mockResolvedValueOnce(contract.selectedVault)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(contract.entryDetail)
    .mockResolvedValueOnce(null);

  await expect(mobileApi.selectVault()).resolves.toEqual(
    contract.selectedVault,
  );
  await expect(mobileApi.unlockVault("attempt-only")).resolves.toEqual(
    contract.snapshot,
  );
  await expect(mobileApi.getVaultSnapshot()).resolves.toEqual(
    contract.snapshot,
  );
  await expect(mobileApi.getEntryDetail("entry-example")).resolves.toEqual(
    contract.entryDetail,
  );
  await expect(mobileApi.lockVault()).resolves.toBeUndefined();

  expect(invoke).toHaveBeenNthCalledWith(1, "mobile_select_vault", undefined);
  expect(invoke).toHaveBeenNthCalledWith(2, "mobile_unlock_vault", {
    password: "attempt-only",
  });
  expect(invoke).toHaveBeenNthCalledWith(3, "mobile_vault_snapshot", undefined);
  expect(invoke).toHaveBeenNthCalledWith(4, "mobile_entry_detail", {
    entryId: "entry-example",
  });
  expect(invoke).toHaveBeenNthCalledWith(5, "mobile_lock_vault", undefined);
});

test("mobile mutation and persistence calls use narrow reviewed payloads", async () => {
  invoke
    .mockResolvedValueOnce(contract.dirtySnapshot)
    .mockResolvedValueOnce(contract.createdEntry)
    .mockResolvedValueOnce(contract.dirtySnapshot)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(null);

  await mobileApi.updateEntry({ entryId: "entry-example", title: "Changed" });
  await mobileApi.createEntry({
    groupId: "group-root",
    title: "Created",
    username: "",
    url: "",
    password: null,
    notes: null,
  });
  await mobileApi.setEntryCustomField({
    entryId: "entry-example",
    name: "Synthetic",
    value: "value",
    protection: "protected",
  });
  await mobileApi.saveVault("attempt-only");
  await mobileApi.reloadVault("reload-only");
  await mobileApi.discardChangesAndLock();

  expect(invoke).toHaveBeenNthCalledWith(1, "mobile_update_entry", {
    request: { entryId: "entry-example", title: "Changed" },
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "mobile_create_entry", {
    request: {
      groupId: "group-root",
      title: "Created",
      username: "",
      url: "",
      password: null,
      notes: null,
    },
  });
  expect(invoke).toHaveBeenNthCalledWith(4, "mobile_save_vault", {
    password: "attempt-only",
  });
  expect(invoke).toHaveBeenNthCalledWith(5, "mobile_reload_vault", {
    password: "reload-only",
  });
  expect(invoke).toHaveBeenNthCalledWith(
    6,
    "mobile_discard_changes_and_lock",
    undefined,
  );
});

test("every mobile edit-load and CRUD adapter remains semantic", async () => {
  invoke
    .mockResolvedValueOnce("title")
    .mockResolvedValueOnce("username")
    .mockResolvedValueOnce("https://example.test")
    .mockResolvedValueOnce("notes")
    .mockResolvedValueOnce("custom")
    .mockResolvedValueOnce(contract.dirtySnapshot)
    .mockResolvedValueOnce(contract.dirtySnapshot)
    .mockResolvedValueOnce(contract.createdGroup)
    .mockResolvedValueOnce(contract.dirtySnapshot)
    .mockResolvedValueOnce(contract.dirtySnapshot)
    .mockResolvedValueOnce(contract.dirtySnapshot)
    .mockResolvedValueOnce(contract.dirtySnapshot);

  await mobileApi.revealEntryTitle("entry-example");
  await mobileApi.revealEntryUsername("entry-example");
  await mobileApi.revealEntryUrl("entry-example");
  await mobileApi.revealEntryNotes("entry-example");
  await mobileApi.revealEntryCustomField("entry-example", "Synthetic");
  await mobileApi.deleteEntry("entry-example");
  await mobileApi.moveEntry("entry-example", "group-other");
  await mobileApi.createGroup("group-root", "Created group");
  await mobileApi.renameGroup("group-other", "Renamed group");
  await mobileApi.moveGroup("group-other", "group-root");
  await mobileApi.deleteGroup("group-other");
  await mobileApi.deleteEntryCustomField("entry-example", "Synthetic");

  expect(invoke).toHaveBeenCalledWith("mobile_load_entry_custom_field", {
    entryId: "entry-example",
    name: "Synthetic",
  });
  expect(invoke).toHaveBeenCalledWith("mobile_move_entry", {
    request: {
      entryId: "entry-example",
      destinationGroupId: "group-other",
    },
  });
  expect(invoke).toHaveBeenCalledWith("mobile_create_group", {
    request: { parentGroupId: "group-root", name: "Created group" },
  });
  expect(invoke).toHaveBeenCalledWith("mobile_move_group", {
    request: { groupId: "group-other", destinationGroupId: "group-root" },
  });
});

test("native failures and unknown errors cannot leak details", async () => {
  invoke.mockRejectedValueOnce({
    code: "future_error",
    message: "content://com.example.secret.provider/document/private%3Avault",
  });
  await expect(mobileApi.selectVault()).rejects.toEqual(
    new MobileCommandError("internal"),
  );

  invoke.mockRejectedValueOnce({
    code: "picker_failed",
    message: "/data/user/0/dev.nian.pass/no_backup/private.kdbx",
  });
  await expect(mobileApi.selectVault()).rejects.toEqual(
    new MobileCommandError("picker_failed"),
  );
});

test("mobile DTO validation rejects extra transport and secret keys", async () => {
  invoke.mockResolvedValueOnce({
    ...contract.selectedVault,
    contentUri: "content://provider/document/id",
  });
  await expect(mobileApi.selectVault()).rejects.toEqual(
    new MobileCommandError("internal"),
  );

  invoke.mockResolvedValueOnce({ ...contract.entryDetail, notes: "secret" });
  await expect(mobileApi.getEntryDetail("entry-example")).rejects.toEqual(
    new MobileCommandError("internal"),
  );

  for (const forbidden of [
    "password",
    "secret",
    "uri",
    "sourceUri",
    "certificate",
    "autofillId",
    "assistStructure",
  ]) {
    invoke.mockResolvedValueOnce({
      ...contract.autofillCandidate,
      [forbidden]: "forbidden",
    });
    await expect(
      mobileApi.getAutofillCandidates("opaque-request-token"),
    ).rejects.toEqual(new MobileCommandError("internal"));
  }
});

test("selection and void validators reject malformed native transport", async () => {
  invoke.mockResolvedValueOnce(null);
  await expect(mobileApi.selectVault()).resolves.toBeNull();

  invoke.mockResolvedValueOnce({ fileName: "vault.kdbx", writable: "yes" });
  await expect(mobileApi.selectVault()).rejects.toEqual(
    new MobileCommandError("internal"),
  );

  invoke.mockResolvedValueOnce({ status: "not-void" });
  await expect(mobileApi.lockVault()).rejects.toEqual(
    new MobileCommandError("internal"),
  );
});

test("mobile security DTOs require exact secret-free keys", async () => {
  const status = {
    foreground: true,
    elapsedRealtimeMs: 1234,
    generation: 7,
    screenState: "active",
    curtainVisible: true,
    vaultState: "dirty",
    operationPending: false,
  } as const;
  invoke
    .mockResolvedValueOnce(status)
    .mockResolvedValueOnce({ acknowledged: true });

  await expect(mobileApi.securityResume()).resolves.toEqual(status);
  await expect(mobileApi.acknowledgeSafeUi(7)).resolves.toEqual({
    acknowledged: true,
  });
  expect(invoke).toHaveBeenNthCalledWith(
    2,
    "mobile_security_acknowledge_safe_ui",
    { generation: 7 },
  );

  invoke.mockResolvedValueOnce({ ...status, password: "forbidden" });
  await expect(mobileApi.securityResume()).rejects.toEqual(
    new MobileCommandError("internal"),
  );

  invoke.mockResolvedValueOnce({ acknowledged: true, sourceUri: "forbidden" });
  await expect(mobileApi.acknowledgeSafeUi(7)).rejects.toEqual(
    new MobileCommandError("internal"),
  );
});
