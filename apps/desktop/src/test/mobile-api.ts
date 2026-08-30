import { vi } from "vitest";

import type {
  CreatedEntryDto,
  CreatedGroupDto,
  EntryDetailDto,
  VaultSnapshotDto,
} from "../types/desktop";
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
  let securityGeneration = 1;
  let securityForeground = !document.hidden;
  return {
    selectVault: vi
      .fn()
      .mockResolvedValue({ fileName: "fixture.kdbx", writable: true }),
    unlockVault: vi.fn().mockResolvedValue(mobileSnapshot),
    getVaultSnapshot: vi.fn().mockResolvedValue(mobileSnapshot),
    getEntryDetail: vi.fn().mockResolvedValue(mobileDetail),
    revealEntryTitle: vi.fn().mockResolvedValue("Synthetic account"),
    revealEntryUsername: vi.fn().mockResolvedValue("mobile-user"),
    revealEntryUrl: vi.fn().mockResolvedValue("https://example.test"),
    revealEntryNotes: vi.fn().mockResolvedValue("synthetic notes"),
    revealEntryCustomField: vi.fn().mockResolvedValue("personal"),
    updateEntry: vi.fn().mockResolvedValue({ ...mobileSnapshot, dirty: true }),
    createEntry: vi.fn().mockResolvedValue({
      createdEntryId: "entry-created",
      snapshot: mobileSnapshot,
    } satisfies CreatedEntryDto),
    deleteEntry: vi.fn().mockResolvedValue(mobileSnapshot),
    moveEntry: vi.fn().mockResolvedValue(mobileSnapshot),
    createGroup: vi.fn().mockResolvedValue({
      createdGroupId: "group-created",
      snapshot: mobileSnapshot,
    } satisfies CreatedGroupDto),
    renameGroup: vi.fn().mockResolvedValue(mobileSnapshot),
    moveGroup: vi.fn().mockResolvedValue(mobileSnapshot),
    deleteGroup: vi.fn().mockResolvedValue(mobileSnapshot),
    setEntryCustomField: vi.fn().mockResolvedValue(mobileSnapshot),
    deleteEntryCustomField: vi.fn().mockResolvedValue(mobileSnapshot),
    saveVault: vi.fn().mockResolvedValue(mobileSnapshot),
    reloadVault: vi.fn().mockResolvedValue(mobileSnapshot),
    lockVault: vi.fn().mockResolvedValue(undefined),
    discardChangesAndLock: vi.fn().mockResolvedValue(undefined),
    securityResume: vi.fn().mockImplementation(() => {
      const foreground = !document.hidden;
      if (foreground !== securityForeground) {
        securityForeground = foreground;
        securityGeneration += 1;
      }
      return Promise.resolve({
        foreground,
        elapsedRealtimeMs: performance.now(),
        generation: securityGeneration,
        screenState: "active",
        curtainVisible: true,
        vaultState: "clean",
        operationPending: false,
      });
    }),
    acknowledgeSafeUi: vi.fn().mockResolvedValue({ acknowledged: true }),
    getAutofillStatus: vi.fn().mockResolvedValue({
      supported: true,
      sourceEnabled: false,
      providerSelected: false,
    }),
    enableAutofill: vi.fn().mockResolvedValue({
      supported: true,
      sourceEnabled: true,
      providerSelected: false,
    }),
    disableAutofill: vi.fn().mockResolvedValue({
      supported: true,
      sourceEnabled: false,
      providerSelected: false,
    }),
    refreshAutofill: vi.fn().mockResolvedValue({
      supported: true,
      sourceEnabled: true,
      providerSelected: false,
    }),
    getAutofillRequest: vi.fn().mockResolvedValue(null),
    getAutofillCandidates: vi.fn().mockResolvedValue([]),
    publishAutofillCandidates: vi.fn().mockResolvedValue(undefined),
    approveAutofill: vi.fn().mockResolvedValue(undefined),
    cancelAutofill: vi.fn().mockResolvedValue(undefined),
    openAutofillSettings: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
