import { vi } from "vitest";

import type { DesktopApi } from "../lib/desktop";
import type { EntryDetailDto, VaultSnapshotDto } from "../types/desktop";

export const mutationSnapshot: VaultSnapshotDto = {
  dirty: true,
  recycleBinEnabled: true,
  recycleBinGroupId: null,
  fileName: "fixture.kdbx",
  capabilities: {
    formatVersion: "4.1",
    writable: true,
    writeRestriction: null,
  },
  rootGroupId: "group-root",
  groups: [
    {
      id: "group-root",
      name: "Root",
      childGroupIds: ["group-child"],
      entryIds: ["entry-a"],
    },
    {
      id: "group-child",
      name: "Child",
      childGroupIds: [],
      entryIds: [],
    },
  ],
  entries: [
    {
      id: "entry-a",
      groupId: "group-root",
      title: { kind: "visible", value: "Account A" },
      username: { kind: "visible", value: "user-a" },
      url: { kind: "visible", value: "m4.3://a" },
      passwordPresent: true,
      notesPresent: true,
      totpPresent: false,
      tags: [],
      expiresAtUnixSeconds: null,
      icon: { kind: "none" },
    },
  ],
};

export const mutationDetail: EntryDetailDto = {
  id: "entry-a",
  title: { kind: "visible", value: "Account A" },
  username: { kind: "visible", value: "user-a" },
  url: { kind: "visible", value: "m4.3://a" },
  passwordPresent: true,
  notesPresent: true,
  totpPresent: false,
  tags: [],
  expiresAtUnixSeconds: null,
  icon: { kind: "none" },
  customFields: [{ name: "Private", protection: "protected" }],
};

export function mutationApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    selectVault: vi.fn().mockResolvedValue({ fileName: "fixture.kdbx" }),
    selectKeyfile: vi.fn().mockResolvedValue({ fileName: "fixture.keyx" }),
    clearKeyfile: vi.fn().mockResolvedValue(undefined),
    credentialHasKeyfile: vi.fn().mockResolvedValue(false),
    credentialHasPassword: vi.fn().mockResolvedValue(true),
    replaceKeyfile: vi.fn().mockResolvedValue({ fileName: "replacement.keyx" }),
    removeKeyfile: vi.fn().mockResolvedValue(undefined),
    createVault: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    unlockVault: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    unlockVaultWithKeyfile: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    getVaultSnapshot: vi.fn().mockResolvedValue(mutationSnapshot),
    saveVault: vi.fn().mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    exportVaultCopy: vi.fn().mockResolvedValue(true),
    getDatabaseMetadata: vi
      .fn()
      .mockResolvedValue({ name: "", description: "", defaultUsername: "" }),
    updateDatabaseMetadata: vi.fn().mockResolvedValue({
      metadata: { name: "", description: "", defaultUsername: "" },
      snapshot: mutationSnapshot,
    }),
    getHistoryPolicy: vi.fn().mockResolvedValue({
      maxItems: 10,
      maximumEditableItems: 10_000,
    }),
    setHistoryMaxItems: vi.fn().mockResolvedValue({
      policy: { maxItems: 10, maximumEditableItems: 10_000 },
      snapshot: mutationSnapshot,
    }),
    setRecycleBinEnabled: vi.fn().mockResolvedValue(mutationSnapshot),
    changeMasterPassword: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    removeMasterPassword: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    reloadVault: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    getEntryDetail: vi.fn().mockResolvedValue(mutationDetail),
    getPasswordHealthReport: vi.fn().mockResolvedValue({
      totalEntries: 1,
      passwordEntries: 1,
      minimumLength: 12,
      weakScoreThreshold: 3,
      issues: [],
    }),
    getEntryHistory: vi.fn().mockResolvedValue({
      documentRevision: "2",
      items: [],
    }),
    restoreEntryHistory: vi.fn().mockResolvedValue(mutationSnapshot),
    getEntryAttachments: vi.fn().mockResolvedValue([]),
    importEntryCustomIcon: vi.fn().mockResolvedValue(mutationSnapshot),
    importEntryAttachment: vi.fn().mockResolvedValue(mutationSnapshot),
    exportEntryAttachment: vi.fn().mockResolvedValue({ exported: true }),
    revealEntryPassword: vi.fn().mockResolvedValue("old-password"),
    revealEntryNotes: vi.fn().mockResolvedValue("secret notes"),
    revealEntryTotp: vi.fn().mockResolvedValue({
      code: "123456",
      validForSeconds: 20,
      periodSeconds: 30,
    }),
    revealEntryTitle: vi.fn().mockResolvedValue("protected title"),
    revealEntryUsername: vi.fn().mockResolvedValue("protected username"),
    revealEntryUrl: vi.fn().mockResolvedValue("protected url"),
    openEntryUrl: vi.fn().mockResolvedValue(undefined),
    revealEntryCustomField: vi.fn().mockResolvedValue("custom secret"),
    copyEntryCustomField: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryTitle: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryUsername: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryUrl: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryNotes: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyGeneratedPassword: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryPassword: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryTotp: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    setEntryTags: vi.fn().mockResolvedValue(mutationSnapshot),
    updateEntry: vi.fn().mockResolvedValue(mutationSnapshot),
    createEntry: vi.fn().mockResolvedValue({
      createdEntryId: "entry-created",
      snapshot: mutationSnapshot,
    }),
    duplicateEntry: vi.fn().mockResolvedValue({
      createdEntryId: "entry-duplicate",
      snapshot: mutationSnapshot,
    }),
    deleteEntry: vi.fn().mockResolvedValue(mutationSnapshot),
    restoreEntry: vi.fn().mockResolvedValue(mutationSnapshot),
    permanentlyDeleteEntry: vi.fn().mockResolvedValue(mutationSnapshot),
    moveEntry: vi.fn().mockResolvedValue(mutationSnapshot),
    moveEntries: vi.fn().mockResolvedValue(mutationSnapshot),
    trashEntries: vi.fn().mockResolvedValue(mutationSnapshot),
    restoreEntries: vi.fn().mockResolvedValue(mutationSnapshot),
    permanentlyDeleteEntries: vi.fn().mockResolvedValue(mutationSnapshot),
    createGroup: vi.fn().mockResolvedValue({
      createdGroupId: "group-created",
      snapshot: mutationSnapshot,
    }),
    renameGroup: vi.fn().mockResolvedValue(mutationSnapshot),
    moveGroup: vi.fn().mockResolvedValue(mutationSnapshot),
    deleteGroup: vi.fn().mockResolvedValue(mutationSnapshot),
    restoreGroup: vi.fn().mockResolvedValue(mutationSnapshot),
    permanentlyDeleteGroup: vi.fn().mockResolvedValue(mutationSnapshot),
    setEntryCustomField: vi.fn().mockResolvedValue(mutationSnapshot),
    deleteEntryCustomField: vi.fn().mockResolvedValue(mutationSnapshot),
    closePolicy: vi.fn().mockResolvedValue({ policy: "allow" }),
    lockVault: vi.fn().mockResolvedValue({ clipboard: "not_owned" }),
    discardChangesAndLock: vi
      .fn()
      .mockResolvedValue({ clipboard: "not_owned" }),
    syncProfiles: vi.fn().mockResolvedValue([]),
    saveSyncProfile: vi.fn(),
    deleteSyncProfile: vi.fn(),
    resetSyncState: vi.fn(),
    testSyncProvider: vi.fn(),
    syncNow: vi.fn(),
    resolveSyncConflict: vi.fn(),
    ...overrides,
  };
}
