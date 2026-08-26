import { vi } from "vitest";

import type { EntryDetailDto, VaultSnapshotDto } from "../types/desktop";
import type { MobileApi } from "../types/mobile";

export const mobileSnapshot: VaultSnapshotDto = {
  dirty: false,
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
      name: "Accounts",
      childGroupIds: [],
      entryIds: [],
    },
  ],
  entries: [
    {
      id: "entry-a",
      groupId: "group-root",
      title: { kind: "visible", value: "Synthetic account" },
      username: { kind: "visible", value: "mobile-user" },
      url: { kind: "protected" },
      passwordPresent: true,
      notesPresent: true,
      tags: ["synthetic"],
    },
  ],
};

export const mobileDetail: EntryDetailDto = {
  id: "entry-a",
  title: { kind: "visible", value: "Synthetic account" },
  username: { kind: "visible", value: "mobile-user" },
  url: { kind: "protected" },
  passwordPresent: true,
  notesPresent: true,
  customFields: [{ name: "Account type", protection: "unprotected" }],
};

export function createMobileApi(overrides: Partial<MobileApi> = {}): MobileApi {
  return {
    selectVault: vi.fn().mockResolvedValue({ fileName: "fixture.kdbx" }),
    unlockVault: vi.fn().mockResolvedValue(mobileSnapshot),
    getVaultSnapshot: vi.fn().mockResolvedValue(mobileSnapshot),
    getEntryDetail: vi.fn().mockResolvedValue(mobileDetail),
    lockVault: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
