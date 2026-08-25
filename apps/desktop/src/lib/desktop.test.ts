import { afterEach, expect, test, vi } from "vitest";

import contract from "../../contracts/desktop-contract.json";
import { DesktopCommandError, desktopApi } from "./desktop";
import {
  parseClipboardReceipt,
  parseEntryDetail,
  parseLockResult,
  parseSecretString,
} from "./entry-validation";
import {
  parseClosePolicy,
  parseCreatedEntry,
  parseCreatedGroup,
  parseDesktopErrorCode,
  parseSelectedVault,
  parseSummaryText,
  parseVaultSnapshot,
} from "./validation";

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
  await expect(desktopApi.copyEntryUsername("entry-example")).resolves.toEqual(
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
  expect(invoke).toHaveBeenNthCalledWith(8, "copy_entry_password", {
    entryId: "entry-example",
  });
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
    if (command === "create_entry")
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
    desktopApi.createEntry({
      groupId: "group-root",
      title: "Created",
      username: "",
      url: "",
      password: null,
      notes: null,
    }),
  ).resolves.toEqual(contract.createdEntry);
  await expect(desktopApi.deleteEntry("entry-example")).resolves.toEqual(
    contract.snapshot,
  );
  await expect(
    desktopApi.moveEntry("entry-example", "group-root"),
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
});

test("M4.3 response validators reject expansion and malformed dirty state", () => {
  expect(() =>
    parseCreatedEntry({ ...contract.createdEntry, password: "must-not-cross" }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseVaultSnapshot({ ...contract.snapshot, dirty: "yes" }),
  ).toThrow(/invalid desktop contract/);
  expect(() => parseClosePolicy({ policy: "save_then_close" })).toThrow(
    /invalid desktop contract/,
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
