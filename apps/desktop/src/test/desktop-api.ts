import { vi } from "vitest";

import type { DesktopApi } from "../lib/desktop";
import type { EntryDetailDto, VaultSnapshotDto } from "../types/desktop";

export const mutationSnapshot: VaultSnapshotDto = {
  dirty: true,
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
      tags: [],
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
  customFields: [{ name: "Private", protection: "protected" }],
};

export function mutationApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    selectVault: vi.fn().mockResolvedValue({ fileName: "fixture.kdbx" }),
    unlockVault: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    getVaultSnapshot: vi.fn().mockResolvedValue(mutationSnapshot),
    saveVault: vi.fn().mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    reloadVault: vi
      .fn()
      .mockResolvedValue({ ...mutationSnapshot, dirty: false }),
    getEntryDetail: vi.fn().mockResolvedValue(mutationDetail),
    revealEntryPassword: vi.fn().mockResolvedValue("old-password"),
    revealEntryNotes: vi.fn().mockResolvedValue("secret notes"),
    revealEntryTitle: vi.fn().mockResolvedValue("protected title"),
    revealEntryUsername: vi.fn().mockResolvedValue("protected username"),
    revealEntryUrl: vi.fn().mockResolvedValue("protected url"),
    revealEntryCustomField: vi.fn().mockResolvedValue("custom secret"),
    copyEntryUsername: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    copyEntryPassword: vi
      .fn()
      .mockResolvedValue({ copied: true, expiresInMs: 30_000 }),
    updateEntry: vi.fn().mockResolvedValue(mutationSnapshot),
    createEntry: vi.fn().mockResolvedValue({
      createdEntryId: "entry-created",
      snapshot: mutationSnapshot,
    }),
    deleteEntry: vi.fn().mockResolvedValue(mutationSnapshot),
    moveEntry: vi.fn().mockResolvedValue(mutationSnapshot),
    createGroup: vi.fn().mockResolvedValue({
      createdGroupId: "group-created",
      snapshot: mutationSnapshot,
    }),
    renameGroup: vi.fn().mockResolvedValue(mutationSnapshot),
    moveGroup: vi.fn().mockResolvedValue(mutationSnapshot),
    deleteGroup: vi.fn().mockResolvedValue(mutationSnapshot),
    setEntryCustomField: vi.fn().mockResolvedValue(mutationSnapshot),
    deleteEntryCustomField: vi.fn().mockResolvedValue(mutationSnapshot),
    closePolicy: vi.fn().mockResolvedValue({ policy: "allow" }),
    lockVault: vi.fn().mockResolvedValue({ clipboard: "not_owned" }),
    discardChangesAndLock: vi
      .fn()
      .mockResolvedValue({ clipboard: "not_owned" }),
    ...overrides,
  };
}
