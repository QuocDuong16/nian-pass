import { afterEach, expect, test, vi } from "vitest";

import contract from "../../contracts/desktop-contract.json";
import { DesktopCommandError, desktopApi, runtimeApi } from "./desktop";
import {
  parseAttachmentExportReceipt,
  parseClipboardReceipt,
  parseEntryAttachments,
  parseEntryDetail,
  parseEntryHistory,
  parseLockResult,
  parseSecretString,
  parseTotpCode,
} from "./entry-validation";
import {
  parseClosePolicy,
  parseCleanVaultSnapshot,
  parseCreatedEntry,
  parseCreatedGroup,
  parseDesktopErrorCode,
  parseSelectedKeyfile,
  parseSelectedVault,
  parseSummaryText,
  parseVaultSnapshot,
} from "./validation";
import { parsePasswordHealthReport } from "./password-health-validation";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(() => {
  invoke.mockReset();
});

test("committed Rust contract fixture passes runtime validation", () => {
  expect(parseSelectedVault(contract.selectedVault)).toEqual(
    contract.selectedVault,
  );
  expect(parseVaultSnapshot(contract.snapshot)).toEqual(contract.snapshot);
  expect(parseCreatedEntry(contract.createdEntry)).toEqual(
    contract.createdEntry,
  );
  expect(parseCreatedGroup(contract.createdGroup)).toEqual(
    contract.createdGroup,
  );
  expect(contract.closePolicies.map(parseClosePolicy)).toEqual(
    contract.closePolicies,
  );
  expect(parseEntryDetail(contract.entryDetail)).toEqual(contract.entryDetail);
  expect(parseEntryHistory(contract.entryHistory)).toEqual(
    contract.entryHistory,
  );
  expect(parseEntryAttachments(contract.entryAttachments)).toEqual(
    contract.entryAttachments,
  );
  expect(parsePasswordHealthReport(contract.passwordHealthReport)).toEqual(
    contract.passwordHealthReport,
  );
  expect(
    parseAttachmentExportReceipt(contract.attachmentExportReceipt),
  ).toEqual(contract.attachmentExportReceipt);
  expect(parseClipboardReceipt(contract.clipboardReceipt)).toEqual(
    contract.clipboardReceipt,
  );
  expect(contract.lockResults.map(parseLockResult)).toEqual(
    contract.lockResults,
  );
  expect(contract.errorCodes.map(parseDesktopErrorCode)).toEqual(
    contract.errorCodes,
  );
});

test("desktop keyfile adapter keeps key material out of IPC responses", async () => {
  invoke
    .mockResolvedValueOnce({ fileName: "unlock.keyx" })
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce({ fileName: "replacement.keyx" })
    .mockResolvedValueOnce(null);

  await expect(desktopApi.selectKeyfile()).resolves.toEqual({
    fileName: "unlock.keyx",
  });
  await expect(desktopApi.clearKeyfile()).resolves.toBeUndefined();
  await expect(desktopApi.unlockVaultWithKeyfile(null)).resolves.toEqual(
    contract.snapshot,
  );
  await expect(
    desktopApi.unlockVaultWithKeyfile("public-composite-password"),
  ).resolves.toEqual(contract.snapshot);
  await expect(desktopApi.credentialHasKeyfile()).resolves.toBe(true);
  await expect(desktopApi.replaceKeyfile()).resolves.toEqual({
    fileName: "replacement.keyx",
  });
  await expect(desktopApi.removeKeyfile()).resolves.toBeUndefined();

  expect(invoke).toHaveBeenNthCalledWith(1, "select_keyfile", undefined);
  expect(invoke).toHaveBeenNthCalledWith(2, "clear_keyfile", undefined);
  expect(invoke).toHaveBeenNthCalledWith(3, "unlock_vault_with_keyfile", {
    password: null,
  });
  expect(invoke).toHaveBeenNthCalledWith(4, "unlock_vault_with_keyfile", {
    password: "public-composite-password",
  });
  expect(invoke).toHaveBeenNthCalledWith(
    5,
    "credential_has_keyfile",
    undefined,
  );
  expect(invoke).toHaveBeenNthCalledWith(6, "replace_keyfile", undefined);
  expect(invoke).toHaveBeenNthCalledWith(7, "remove_keyfile", undefined);
  expect(() =>
    parseSelectedKeyfile({ fileName: "unlock.keyx", bytes: "must-not-cross" }),
  ).toThrow(/invalid desktop contract/);
});

test("desktop create adapter accepts canonical snapshots and native cancellation", async () => {
  invoke.mockResolvedValueOnce(contract.snapshot).mockResolvedValueOnce(null);

  await expect(
    desktopApi.createVault("Personal", "create-secret"),
  ).resolves.toEqual(contract.snapshot);
  expect(invoke).toHaveBeenNthCalledWith(1, "create_vault", {
    vaultName: "Personal",
    password: "create-secret",
  });
  await expect(
    desktopApi.createVault("Cancelled", "unused-secret"),
  ).resolves.toBeNull();
});

test("desktop adapter validates successful IPC responses", async () => {
  invoke
    .mockResolvedValueOnce(contract.selectedVault)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(contract.entryDetail)
    .mockResolvedValueOnce("test-secret-password-M4.2")
    .mockResolvedValueOnce("test-secret-notes-M4.2")
    .mockResolvedValueOnce(contract.clipboardReceipt)
    .mockResolvedValueOnce(contract.clipboardReceipt)
    .mockResolvedValueOnce(contract.clipboardReceipt)
    .mockResolvedValueOnce(contract.clipboardReceipt)
    .mockResolvedValueOnce(contract.clipboardReceipt)
    .mockResolvedValueOnce(contract.clipboardReceipt)
    .mockResolvedValueOnce(contract.lockResults[0]);

  await expect(desktopApi.selectVault()).resolves.toEqual(
    contract.selectedVault,
  );
  await expect(desktopApi.unlockVault("test-password")).resolves.toEqual(
    contract.snapshot,
  );
  await expect(desktopApi.getVaultSnapshot()).resolves.toEqual(
    contract.snapshot,
  );
  await expect(desktopApi.getEntryDetail("entry-example")).resolves.toEqual(
    contract.entryDetail,
  );
  await expect(desktopApi.revealEntryPassword("entry-example")).resolves.toBe(
    "test-secret-password-M4.2",
  );
  await expect(desktopApi.revealEntryNotes("entry-example")).resolves.toBe(
    "test-secret-notes-M4.2",
  );
  await expect(
    desktopApi.copyEntryCustomField("entry-example", "Private"),
  ).resolves.toEqual(contract.clipboardReceipt);
  await expect(desktopApi.copyEntryTitle("entry-example")).resolves.toEqual(
    contract.clipboardReceipt,
  );
  await expect(desktopApi.copyEntryUsername("entry-example")).resolves.toEqual(
    contract.clipboardReceipt,
  );
  await expect(desktopApi.copyEntryUrl("entry-example")).resolves.toEqual(
    contract.clipboardReceipt,
  );
  await expect(desktopApi.copyEntryNotes("entry-example")).resolves.toEqual(
    contract.clipboardReceipt,
  );
  await expect(desktopApi.copyEntryPassword("entry-example")).resolves.toEqual(
    contract.clipboardReceipt,
  );
  await expect(desktopApi.lockVault()).resolves.toEqual(
    contract.lockResults[0],
  );
  expect(invoke).toHaveBeenNthCalledWith(2, "unlock_vault", {
    password: "test-password",
  });
  expect(invoke).toHaveBeenNthCalledWith(7, "copy_entry_custom_field", {
    entryId: "entry-example",
    name: "Private",
  });
  expect(invoke).toHaveBeenNthCalledWith(8, "copy_entry_title", {
    entryId: "entry-example",
  });
  expect(invoke).toHaveBeenNthCalledWith(10, "copy_entry_url", {
    entryId: "entry-example",
  });
  expect(invoke).toHaveBeenNthCalledWith(11, "copy_entry_notes", {
    entryId: "entry-example",
  });
  expect(invoke).toHaveBeenNthCalledWith(12, "copy_entry_password", {
    entryId: "entry-example",
  });
});

test("password health adapter invokes the local report command and validates metadata", async () => {
  invoke.mockResolvedValueOnce(contract.passwordHealthReport);

  await expect(desktopApi.getPasswordHealthReport()).resolves.toEqual(
    contract.passwordHealthReport,
  );
  expect(invoke).toHaveBeenCalledWith("password_health_report", undefined);
});

test("TOTP desktop adapter validates ephemeral codes and narrow clipboard receipts", async () => {
  const code = { code: "123456", validForSeconds: 12, periodSeconds: 30 };
  invoke
    .mockResolvedValueOnce(code)
    .mockResolvedValueOnce(contract.clipboardReceipt);

  await expect(desktopApi.revealEntryTotp("entry-example")).resolves.toEqual(
    code,
  );
  await expect(desktopApi.copyEntryTotp("entry-example")).resolves.toEqual(
    contract.clipboardReceipt,
  );
  expect(invoke).toHaveBeenNthCalledWith(1, "reveal_entry_totp", {
    entryId: "entry-example",
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "copy_entry_totp_code", {
    entryId: "entry-example",
  });

  expect(() =>
    parseTotpCode({
      code: "not-a-code",
      validForSeconds: 12,
      periodSeconds: 30,
    }),
  ).toThrow(/invalid desktop contract/);
});

test("history adapter preserves opaque revision tokens and validates restore wiring", async () => {
  invoke
    .mockResolvedValueOnce(contract.entryHistory)
    .mockResolvedValueOnce(contract.snapshot);

  await expect(desktopApi.getEntryHistory("entry-example")).resolves.toEqual(
    contract.entryHistory,
  );
  await expect(
    desktopApi.restoreEntryHistory("entry-example", 0, "18446744073709551615"),
  ).resolves.toEqual(contract.snapshot);
  expect(invoke).toHaveBeenNthCalledWith(1, "entry_history", {
    entryId: "entry-example",
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "restore_entry_history", {
    entryId: "entry-example",
    historyIndex: 0,
    expectedDocumentRevision: "18446744073709551615",
  });
});

test("history contract rejects unsafe revision numbers and malformed items", () => {
  expect(() =>
    parseEntryHistory({ ...contract.entryHistory, documentRevision: 3 }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseEntryHistory({
      ...contract.entryHistory,
      items: [{ ...contract.entryHistory.items[0], index: -1 }],
    }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseEntryHistory({
      ...contract.entryHistory,
      items: [
        { ...contract.entryHistory.items[0], password: "must-not-cross" },
      ],
    }),
  ).toThrow(/invalid desktop contract/);
});

test("attachment adapter keeps bytes native and validates metadata receipts", async () => {
  invoke
    .mockResolvedValueOnce(contract.entryAttachments)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(contract.attachmentExportReceipt)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null);

  await expect(
    desktopApi.getEntryAttachments("entry-example"),
  ).resolves.toEqual(contract.entryAttachments);
  await expect(
    desktopApi.importEntryAttachment("entry-example"),
  ).resolves.toEqual(contract.snapshot);
  await expect(
    desktopApi.exportEntryAttachment("entry-example", "manual.pdf"),
  ).resolves.toEqual(contract.attachmentExportReceipt);
  await expect(
    desktopApi.importEntryAttachment("entry-example"),
  ).resolves.toBeNull();
  await expect(
    desktopApi.exportEntryAttachment("entry-example", "manual.pdf"),
  ).resolves.toBeNull();

  expect(invoke).toHaveBeenNthCalledWith(1, "entry_attachments", {
    entryId: "entry-example",
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "import_entry_attachment", {
    entryId: "entry-example",
  });
  expect(invoke).toHaveBeenNthCalledWith(3, "export_entry_attachment", {
    entryId: "entry-example",
    name: "manual.pdf",
  });
});

test("custom icon adapter keeps image bytes behind the native command", async () => {
  invoke.mockResolvedValueOnce(contract.snapshot).mockResolvedValueOnce(null);

  await expect(
    desktopApi.importEntryCustomIcon("entry-example"),
  ).resolves.toEqual(contract.snapshot);
  await expect(
    desktopApi.importEntryCustomIcon("entry-example"),
  ).resolves.toBeNull();

  expect(invoke).toHaveBeenNthCalledWith(1, "import_entry_custom_icon", {
    entryId: "entry-example",
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "import_entry_custom_icon", {
    entryId: "entry-example",
  });
});

test("attachment contract rejects bytes and malformed metadata", () => {
  expect(() =>
    parseEntryAttachments([
      { ...contract.entryAttachments[0], bytes: [1, 2, 3] },
    ]),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseEntryAttachments([{ ...contract.entryAttachments[0], sizeBytes: -1 }]),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseEntryAttachments([
      { ...contract.entryAttachments[0], protected: "yes" },
    ]),
  ).toThrow(/invalid desktop contract/);
  expect(() => parseAttachmentExportReceipt({ exported: false })).toThrow(
    /invalid desktop contract/,
  );
});

test("runtime adapter invokes the narrow platform command and validates it", async () => {
  invoke.mockResolvedValue({
    platform: "desktop",
    version: "0.1.0",
    commit: "unknown",
  });

  await expect(runtimeApi.getInfo()).resolves.toEqual({
    platform: "desktop",
    version: "0.1.0",
    commit: "unknown",
  });
  expect(invoke).toHaveBeenCalledWith("runtime_info", undefined);
});

test("missing rootGroupId becomes a generic internal failure", async () => {
  const malformed = structuredClone(contract.snapshot) as Record<
    string,
    unknown
  >;
  Reflect.deleteProperty(malformed, "rootGroupId");
  invoke.mockResolvedValue(malformed);

  await expect(desktopApi.getVaultSnapshot()).rejects.toMatchObject({
    code: "internal",
  });
});

test("unknown summary kind and wrong field type fail closed", () => {
  expect(() =>
    parseSummaryText({ kind: "future-secret-kind", value: "test-password" }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseVaultSnapshot({ ...contract.snapshot, rootGroupId: 123 }),
  ).toThrow(/invalid desktop contract/);
});

test("expiry metadata accepts safe integer seconds and rejects wrong types", () => {
  const snapshotEntry = contract.snapshot.entries[0];
  if (snapshotEntry === undefined) throw new Error("contract entry missing");
  const parsedSnapshot = parseVaultSnapshot({
    ...contract.snapshot,
    entries: [{ ...snapshotEntry, expiresAtUnixSeconds: 2_000_000_000 }],
  });
  expect(parsedSnapshot.entries[0]?.expiresAtUnixSeconds).toBe(2_000_000_000);
  expect(
    parseEntryDetail({
      ...contract.entryDetail,
      expiresAtUnixSeconds: 2_000_000_000,
    }).expiresAtUnixSeconds,
  ).toBe(2_000_000_000);
  expect(() =>
    parseEntryDetail({ ...contract.entryDetail, expiresAtUnixSeconds: "soon" }),
  ).toThrow(/invalid desktop contract/);
});

test("standalone generated password uses narrow native clipboard IPC and validates receipts", async () => {
  invoke.mockResolvedValueOnce(contract.clipboardReceipt);
  await expect(
    desktopApi.copyGeneratedPassword("generated-offline-value"),
  ).resolves.toEqual(contract.clipboardReceipt);
  expect(invoke).toHaveBeenCalledWith("copy_generated_password", {
    password: "generated-offline-value",
  });
  invoke.mockResolvedValueOnce({
    ...contract.clipboardReceipt,
    secret: "unexpected",
  });
  await expect(
    desktopApi.copyGeneratedPassword("retry-value"),
  ).rejects.toMatchObject({
    code: "internal",
  });
});

test("new M4.2 responses reject unknown keys and wrong secret types", () => {
  expect(() =>
    parseEntryDetail({ ...contract.entryDetail, notes: "must-not-cross" }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseClipboardReceipt({ ...contract.clipboardReceipt, value: "secret" }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseEntryDetail({
      ...contract.entryDetail,
      customFields: [{ name: "Future", protection: "future" }],
    }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseEntryDetail({ ...contract.entryDetail, passwordPresent: "yes" }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseClipboardReceipt({ copied: false, expiresInMs: 30_000 }),
  ).toThrow(/invalid desktop contract/);
  expect(() => parseLockResult({ clipboard: "future" })).toThrow(
    /invalid desktop contract/,
  );
  expect(() => parseSecretString({ value: "secret" })).toThrow(
    /invalid desktop contract/,
  );
});

test("unknown error codes become internal while known codes remain stable", async () => {
  invoke.mockRejectedValueOnce({
    code: "future_error",
    detail: "sensitive parser detail",
  });
  await expect(desktopApi.selectVault()).rejects.toEqual(
    new DesktopCommandError("internal"),
  );

  invoke.mockRejectedValueOnce({ code: "unlock_failed" });
  await expect(desktopApi.selectVault()).rejects.toEqual(
    new DesktopCommandError("unlock_failed"),
  );
});

test("snapshot relation mismatches fail closed", () => {
  const missingRoot = structuredClone(contract.snapshot);
  missingRoot.groups = [];
  expect(() => parseVaultSnapshot(missingRoot)).toThrow(
    /invalid desktop contract/,
  );

  const wrongGroup = structuredClone(contract.snapshot);
  const entry = wrongGroup.entries[0];
  if (entry === undefined) throw new Error("contract fixture entry is missing");
  entry.groupId = "group-other";
  expect(() => parseVaultSnapshot(wrongGroup)).toThrow(
    /invalid desktop contract/,
  );
});

test("M4.3 semantic commands validate every secret-free mutation response", async () => {
  invoke.mockImplementation((command: string) => {
    if (command === "create_entry" || command === "duplicate_entry")
      return Promise.resolve(contract.createdEntry);
    if (command === "create_group")
      return Promise.resolve(contract.createdGroup);
    if (command === "close_policy")
      return Promise.resolve(contract.closePolicies[1]);
    if (command === "discard_changes_and_lock") {
      return Promise.resolve(contract.lockResults[1]);
    }
    if (command.startsWith("reveal_entry_"))
      return Promise.resolve("synthetic-value");
    return Promise.resolve(contract.snapshot);
  });

  await expect(
    desktopApi.updateEntry({
      entryId: "entry-example",
      title: "Updated",
      password: "M4.3-SYNTHETIC-PASSWORD",
    }),
  ).resolves.toEqual(contract.snapshot);
  await expect(
    desktopApi.setEntryTags("entry-example", ["finance", "primary"]),
  ).resolves.toEqual(contract.snapshot);
  await expect(
    desktopApi.createEntry({
      groupId: "group-root",
      title: "Created",
      username: "",
      url: "",
      password: null,
      notes: null,
    }),
  ).resolves.toEqual(contract.createdEntry);
  await expect(desktopApi.duplicateEntry("entry-example")).resolves.toEqual(
    contract.createdEntry,
  );
  await expect(desktopApi.deleteEntry("entry-example")).resolves.toEqual(
    contract.snapshot,
  );
  await expect(desktopApi.restoreEntry("entry-example")).resolves.toEqual(
    contract.snapshot,
  );
  await expect(
    desktopApi.permanentlyDeleteEntry("entry-example"),
  ).resolves.toEqual(contract.snapshot);
  await expect(
    desktopApi.moveEntry("entry-example", "group-root"),
  ).resolves.toEqual(contract.snapshot);
  await expect(
    desktopApi.moveEntries(["entry-example", "entry-other"], "group-root"),
  ).resolves.toEqual(contract.snapshot);
  await expect(
    desktopApi.trashEntries(["entry-example", "entry-other"]),
  ).resolves.toEqual(contract.snapshot);
  await expect(
    desktopApi.restoreEntries(["entry-example", "entry-other"]),
  ).resolves.toEqual(contract.snapshot);
  await expect(
    desktopApi.permanentlyDeleteEntries(["entry-example", "entry-other"]),
  ).resolves.toEqual(contract.snapshot);
  await expect(desktopApi.createGroup("group-root", "Child")).resolves.toEqual(
    contract.createdGroup,
  );
  await expect(
    desktopApi.renameGroup("group-root", "Renamed"),
  ).resolves.toEqual(contract.snapshot);
  await expect(desktopApi.moveGroup("group-a", "group-root")).resolves.toEqual(
    contract.snapshot,
  );
  await expect(desktopApi.deleteGroup("group-a")).resolves.toEqual(
    contract.snapshot,
  );
  await expect(desktopApi.restoreGroup("group-a")).resolves.toEqual(
    contract.snapshot,
  );
  await expect(desktopApi.permanentlyDeleteGroup("group-a")).resolves.toEqual(
    contract.snapshot,
  );
  await expect(
    desktopApi.setEntryCustomField({
      entryId: "entry-example",
      name: "Synthetic",
      value: "M4.3-SYNTHETIC-CUSTOM",
      protection: "protected",
    }),
  ).resolves.toEqual(contract.snapshot);
  await expect(
    desktopApi.deleteEntryCustomField("entry-example", "Synthetic"),
  ).resolves.toEqual(contract.snapshot);
  await expect(desktopApi.closePolicy()).resolves.toEqual(
    contract.closePolicies[1],
  );
  await expect(desktopApi.discardChangesAndLock()).resolves.toEqual(
    contract.lockResults[1],
  );
  await expect(desktopApi.revealEntryTitle("entry-example")).resolves.toBe(
    "synthetic-value",
  );
  await expect(desktopApi.revealEntryUsername("entry-example")).resolves.toBe(
    "synthetic-value",
  );
  await expect(desktopApi.revealEntryUrl("entry-example")).resolves.toBe(
    "synthetic-value",
  );
  await expect(
    desktopApi.revealEntryCustomField("entry-example", "Synthetic"),
  ).resolves.toBe("synthetic-value");

  expect(invoke).toHaveBeenCalledWith("update_entry", {
    request: {
      entryId: "entry-example",
      title: "Updated",
      password: "M4.3-SYNTHETIC-PASSWORD",
    },
  });
  expect(invoke).toHaveBeenCalledWith("set_entry_tags", {
    request: { entryId: "entry-example", tags: ["finance", "primary"] },
  });
  expect(invoke).toHaveBeenCalledWith("move_entries", {
    request: {
      entryIds: ["entry-example", "entry-other"],
      destinationGroupId: "group-root",
    },
  });
  expect(invoke).toHaveBeenCalledWith("trash_entries", {
    request: { entryIds: ["entry-example", "entry-other"] },
  });
  expect(invoke).toHaveBeenCalledWith("restore_entries", {
    request: { entryIds: ["entry-example", "entry-other"] },
  });
  expect(invoke).toHaveBeenCalledWith("permanently_delete_entries", {
    request: { entryIds: ["entry-example", "entry-other"] },
  });
});

test("M4.3 response validators reject expansion and malformed dirty state", () => {
  expect(() =>
    parseCreatedEntry({ ...contract.createdEntry, password: "must-not-cross" }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseVaultSnapshot({ ...contract.snapshot, dirty: "yes" }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseVaultSnapshot({
      ...contract.snapshot,
      capabilities: {
        ...contract.snapshot.capabilities,
        writeRestriction: "unknown_restriction",
      },
    }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseVaultSnapshot({
      ...contract.snapshot,
      capabilities: {
        ...contract.snapshot.capabilities,
        writable: false,
        writeRestriction: null,
      },
    }),
  ).toThrow(/invalid desktop contract/);
  expect(() => parseClosePolicy({ policy: "save_then_close" })).toThrow(
    /invalid desktop contract/,
  );
});

test("save uses retained session authority while reload accepts a narrow credential", async () => {
  invoke
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(contract.snapshot);
  await expect(desktopApi.saveVault()).resolves.toEqual(contract.snapshot);
  await expect(desktopApi.reloadVault("M4.4-RELOAD-PASSWORD")).resolves.toEqual(
    contract.snapshot,
  );
  await expect(desktopApi.reloadVault(null)).resolves.toEqual(
    contract.snapshot,
  );
  expect(invoke).toHaveBeenNthCalledWith(1, "save_vault", undefined);
  expect(invoke).toHaveBeenNthCalledWith(2, "reload_vault", {
    password: "M4.4-RELOAD-PASSWORD",
  });
  expect(invoke).toHaveBeenNthCalledWith(3, "reload_vault", { password: null });

  expect(() =>
    parseCleanVaultSnapshot({ ...contract.snapshot, dirty: true }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseCleanVaultSnapshot({
      ...contract.snapshot,
      masterPassword: "must-not-cross",
    }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseCleanVaultSnapshot({ ...contract.snapshot, dirty: "false" }),
  ).toThrow(/invalid desktop contract/);
});

test("vault export invokes the native reviewed command and validates the boolean receipt", async () => {
  invoke.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(desktopApi.exportVaultCopy()).resolves.toBe(true);
  await expect(desktopApi.exportVaultCopy()).resolves.toBe(false);
  expect(invoke).toHaveBeenNthCalledWith(1, "export_vault_copy", undefined);
  expect(invoke).toHaveBeenNthCalledWith(2, "export_vault_copy", undefined);

  invoke.mockResolvedValueOnce("yes");
  await expect(desktopApi.exportVaultCopy()).rejects.toMatchObject({
    code: "internal",
  });
});

test("recycle-bin setting invokes the semantic command and accepts the canonical snapshot", async () => {
  invoke.mockResolvedValueOnce({
    ...contract.snapshot,
    dirty: true,
    recycleBinEnabled: false,
  });
  await expect(desktopApi.setRecycleBinEnabled(false)).resolves.toMatchObject({
    dirty: true,
    recycleBinEnabled: false,
  });
  expect(invoke).toHaveBeenCalledWith("set_recycle_bin_enabled", {
    enabled: false,
  });
});

test("database metadata uses explicit read/update commands and validates the receipt", async () => {
  const metadata = {
    name: "Personal",
    description: "Primary vault",
    defaultUsername: "fixture-user",
  };
  invoke
    .mockResolvedValueOnce(metadata)
    .mockResolvedValueOnce({ metadata, snapshot: contract.snapshot });
  await expect(desktopApi.getDatabaseMetadata()).resolves.toEqual(metadata);
  await expect(
    desktopApi.updateDatabaseMetadata(
      metadata.name,
      metadata.description,
      metadata.defaultUsername,
    ),
  ).resolves.toEqual({ metadata, snapshot: contract.snapshot });
  expect(invoke).toHaveBeenNthCalledWith(1, "database_metadata", undefined);
  expect(invoke).toHaveBeenNthCalledWith(2, "update_database_metadata", {
    name: metadata.name,
    description: metadata.description,
    defaultUsername: metadata.defaultUsername,
  });

  invoke.mockResolvedValueOnce({ ...metadata, extra: true });
  await expect(desktopApi.getDatabaseMetadata()).rejects.toMatchObject({
    code: "internal",
  });
});

test("history policy uses explicit read/update commands and rejects malformed contracts", async () => {
  const policy = { maxItems: 10, maximumEditableItems: 10_000 };
  invoke.mockResolvedValueOnce(policy).mockResolvedValueOnce({
    policy: { ...policy, maxItems: 2 },
    snapshot: contract.snapshot,
  });
  await expect(desktopApi.getHistoryPolicy()).resolves.toEqual(policy);
  await expect(desktopApi.setHistoryMaxItems(2)).resolves.toEqual({
    policy: { ...policy, maxItems: 2 },
    snapshot: contract.snapshot,
  });
  expect(invoke).toHaveBeenNthCalledWith(1, "history_policy", undefined);
  expect(invoke).toHaveBeenNthCalledWith(2, "set_history_max_items", {
    maxItems: 2,
  });

  invoke.mockResolvedValueOnce({ maxItems: -1, maximumEditableItems: 10_000 });
  await expect(desktopApi.getHistoryPolicy()).rejects.toMatchObject({
    code: "internal",
  });
});

test("URL opening sends only entry identity and accepts only a void receipt", async () => {
  invoke.mockResolvedValueOnce(null).mockResolvedValueOnce(true);
  await expect(desktopApi.openEntryUrl("entry-a")).resolves.toBeUndefined();
  expect(invoke).toHaveBeenNthCalledWith(1, "open_entry_url", {
    entryId: "entry-a",
  });
  await expect(desktopApi.openEntryUrl("entry-a")).rejects.toMatchObject({
    code: "internal",
  });
});

test("credential rotation invokes the reviewed semantic command and accepts a clean snapshot", async () => {
  invoke.mockResolvedValueOnce(contract.snapshot);
  await expect(desktopApi.changeMasterPassword("alpha")).resolves.toEqual(
    contract.snapshot,
  );
  expect(invoke).toHaveBeenCalledWith("change_master_password", {
    newPassword: "alpha",
  });
});

test("master password removal accepts only the clean reviewed snapshot and status is boolean", async () => {
  invoke
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce("true")
    .mockResolvedValueOnce({ ...contract.snapshot, dirty: true });
  await expect(desktopApi.credentialHasPassword()).resolves.toBe(true);
  await expect(desktopApi.removeMasterPassword()).resolves.toEqual(
    contract.snapshot,
  );
  await expect(desktopApi.credentialHasPassword()).rejects.toMatchObject({
    code: "internal",
  });
  await expect(desktopApi.removeMasterPassword()).rejects.toMatchObject({
    code: "internal",
  });
  expect(invoke).toHaveBeenNthCalledWith(
    1,
    "credential_has_password",
    undefined,
  );
  expect(invoke).toHaveBeenNthCalledWith(
    2,
    "remove_master_password",
    undefined,
  );
  expect(invoke).toHaveBeenNthCalledWith(
    3,
    "credential_has_password",
    undefined,
  );
  expect(invoke).toHaveBeenNthCalledWith(
    4,
    "remove_master_password",
    undefined,
  );
});

test("created entry receipt accepts only an ID contained in its snapshot", () => {
  expect(parseCreatedEntry(contract.createdEntry)).toEqual(
    contract.createdEntry,
  );
  expect(() =>
    parseCreatedEntry({
      ...contract.createdEntry,
      createdEntryId: "ghost-entry",
    }),
  ).toThrow(/invalid desktop contract/);
});

test("created group receipt accepts only an ID contained in its snapshot", () => {
  expect(parseCreatedGroup(contract.createdGroup)).toEqual(
    contract.createdGroup,
  );
  expect(() =>
    parseCreatedGroup({
      ...contract.createdGroup,
      createdGroupId: "ghost-group",
    }),
  ).toThrow(/invalid desktop contract/);
});
