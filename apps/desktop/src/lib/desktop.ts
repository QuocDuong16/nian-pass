import { invoke } from "@tauri-apps/api/core";

import type {
  ClipboardReceiptDto,
  ClosePolicyDto,
  CreateEntryRequest,
  CreatedEntryDto,
  CreatedGroupDto,
  DesktopErrorCode,
  EntryDetailDto,
  EntryId,
  GroupId,
  LockResultDto,
  SelectedVaultDto,
  SetCustomFieldRequest,
  UpdateEntryRequest,
  VaultSnapshotDto,
} from "../types/desktop";
import type { RuntimeInfoDto } from "../types/runtime";
import { createSyncApi, type SyncApi } from "./sync-api";
import {
  parseClipboardReceipt,
  parseEntryDetail,
  parseLockResult,
  parseSecretString,
} from "./entry-validation";
import {
  parseClosePolicy,
  parseCleanVaultSnapshot,
  parseCreatedEntry,
  parseCreatedGroup,
  parseDesktopErrorCode,
  parseSelectedVault,
  parseVaultSnapshot,
} from "./validation";
import { parseRuntimeInfo } from "./runtime-validation";

export interface RuntimeApi {
  getInfo: () => Promise<RuntimeInfoDto>;
}

export interface DesktopApi extends SyncApi {
  selectVault: () => Promise<SelectedVaultDto | null>;
  createVault: (
    vaultName: string,
    password: string,
  ) => Promise<VaultSnapshotDto | null>;
  unlockVault: (password: string) => Promise<VaultSnapshotDto>;
  getVaultSnapshot: () => Promise<VaultSnapshotDto>;
  saveVault: () => Promise<VaultSnapshotDto>;
  reloadVault: (password: string) => Promise<VaultSnapshotDto>;
  getEntryDetail: (entryId: EntryId) => Promise<EntryDetailDto>;
  revealEntryPassword: (entryId: EntryId) => Promise<string>;
  revealEntryNotes: (entryId: EntryId) => Promise<string>;
  revealEntryTitle: (entryId: EntryId) => Promise<string>;
  revealEntryUsername: (entryId: EntryId) => Promise<string>;
  revealEntryUrl: (entryId: EntryId) => Promise<string>;
  revealEntryCustomField: (entryId: EntryId, name: string) => Promise<string>;
  copyEntryUsername: (entryId: EntryId) => Promise<ClipboardReceiptDto>;
  copyEntryPassword: (entryId: EntryId) => Promise<ClipboardReceiptDto>;
  updateEntry: (request: UpdateEntryRequest) => Promise<VaultSnapshotDto>;
  createEntry: (request: CreateEntryRequest) => Promise<CreatedEntryDto>;
  deleteEntry: (entryId: EntryId) => Promise<VaultSnapshotDto>;
  moveEntry: (
    entryId: EntryId,
    destinationGroupId: GroupId,
  ) => Promise<VaultSnapshotDto>;
  createGroup: (
    parentGroupId: GroupId,
    name: string,
  ) => Promise<CreatedGroupDto>;
  renameGroup: (groupId: GroupId, name: string) => Promise<VaultSnapshotDto>;
  moveGroup: (
    groupId: GroupId,
    destinationGroupId: GroupId,
  ) => Promise<VaultSnapshotDto>;
  deleteGroup: (groupId: GroupId) => Promise<VaultSnapshotDto>;
  setEntryCustomField: (
    request: SetCustomFieldRequest,
  ) => Promise<VaultSnapshotDto>;
  deleteEntryCustomField: (
    entryId: EntryId,
    name: string,
  ) => Promise<VaultSnapshotDto>;
  closePolicy: () => Promise<ClosePolicyDto>;
  lockVault: () => Promise<LockResultDto>;
  discardChangesAndLock: () => Promise<LockResultDto>;
}

export class DesktopCommandError extends Error {
  readonly code: DesktopErrorCode;

  constructor(code: DesktopErrorCode) {
    super("Nian Pass desktop command failed");
    this.name = "DesktopCommandError";
    this.code = code;
  }
}

function toDesktopError(error: unknown): DesktopCommandError {
  if (error instanceof DesktopCommandError) return error;
  if (typeof error === "object" && error !== null && "code" in error) {
    try {
      return new DesktopCommandError(
        parseDesktopErrorCode(Reflect.get(error, "code")),
      );
    } catch {
      return new DesktopCommandError("internal");
    }
  }
  return new DesktopCommandError("internal");
}

async function call<T>(
  command: string,
  parse: (value: unknown) => T,
  args?: Record<string, unknown>,
): Promise<T> {
  let value: unknown;
  try {
    value = await invoke<unknown>(command, args);
  } catch (error: unknown) {
    throw toDesktopError(error);
  }
  try {
    return parse(value);
  } catch {
    throw new DesktopCommandError("internal");
  }
}

export const desktopApi: DesktopApi = {
  selectVault: () =>
    call("select_vault", (value) =>
      value === null ? null : parseSelectedVault(value),
    ),
  createVault: (vaultName, password) =>
    call(
      "create_vault",
      (value) => (value === null ? null : parseVaultSnapshot(value)),
      { vaultName, password },
    ),
  unlockVault: (password) =>
    call("unlock_vault", parseVaultSnapshot, { password }),
  getVaultSnapshot: () => call("vault_snapshot", parseVaultSnapshot),
  saveVault: () => call("save_vault", parseCleanVaultSnapshot),
  reloadVault: (password) =>
    call("reload_vault", parseCleanVaultSnapshot, { password }),
  getEntryDetail: (entryId) =>
    call("entry_detail", parseEntryDetail, { entryId }),
  revealEntryPassword: (entryId) =>
    call("reveal_entry_password", parseSecretString, { entryId }),
  revealEntryNotes: (entryId) =>
    call("reveal_entry_notes", parseSecretString, { entryId }),
  revealEntryTitle: (entryId) =>
    call("reveal_entry_title", parseSecretString, { entryId }),
  revealEntryUsername: (entryId) =>
    call("reveal_entry_username", parseSecretString, { entryId }),
  revealEntryUrl: (entryId) =>
    call("reveal_entry_url", parseSecretString, { entryId }),
  revealEntryCustomField: (entryId, name) =>
    call("reveal_entry_custom_field", parseSecretString, { entryId, name }),
  copyEntryUsername: (entryId) =>
    call("copy_entry_username", parseClipboardReceipt, { entryId }),
  copyEntryPassword: (entryId) =>
    call("copy_entry_password", parseClipboardReceipt, { entryId }),
  updateEntry: (request) =>
    call("update_entry", parseVaultSnapshot, { request }),
  createEntry: (request) =>
    call("create_entry", parseCreatedEntry, { request }),
  deleteEntry: (entryId) =>
    call("delete_entry", parseVaultSnapshot, { entryId }),
  moveEntry: (entryId, destinationGroupId) =>
    call("move_entry", parseVaultSnapshot, {
      request: { entryId, destinationGroupId },
    }),
  createGroup: (parentGroupId, name) =>
    call("create_group", parseCreatedGroup, {
      request: { parentGroupId, name },
    }),
  renameGroup: (groupId, name) =>
    call("rename_group", parseVaultSnapshot, { request: { groupId, name } }),
  moveGroup: (groupId, destinationGroupId) =>
    call("move_group", parseVaultSnapshot, {
      request: { groupId, destinationGroupId },
    }),
  deleteGroup: (groupId) =>
    call("delete_group", parseVaultSnapshot, { groupId }),
  setEntryCustomField: (request) =>
    call("set_entry_custom_field", parseVaultSnapshot, { request }),
  deleteEntryCustomField: (entryId, name) =>
    call("delete_entry_custom_field", parseVaultSnapshot, { entryId, name }),
  closePolicy: () => call("close_policy", parseClosePolicy),
  lockVault: () => call("lock_vault", parseLockResult),
  discardChangesAndLock: () =>
    call("discard_changes_and_lock", parseLockResult),
  ...createSyncApi(call),
};

export const runtimeApi: RuntimeApi = {
  getInfo: () => call("runtime_info", parseRuntimeInfo),
};
