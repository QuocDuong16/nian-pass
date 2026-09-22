import { invoke } from "@tauri-apps/api/core";

import type { DesktopErrorCode } from "../types/desktop";
import type { DesktopApi, RuntimeApi } from "./desktop-api-types";
import { createClipboardApi } from "./clipboard-api";
import { createCredentialApi } from "./credential-api";
import { createSyncApi } from "./sync-api";

export type { DesktopApi, RuntimeApi } from "./desktop-api-types";
import {
  parseAttachmentExportReceipt,
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
  parseSelectedVault,
  parseVaultSnapshot,
} from "./validation";
import {
  parseDatabaseMetadata,
  parseDatabaseMetadataUpdateReceipt,
  parseHistoryPolicy,
  parseHistoryPolicyUpdateReceipt,
} from "./database-settings-validation";
import { parsePasswordHealthReport } from "./password-health-validation";
import { parseRuntimeInfo } from "./runtime-validation";

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

function parseVoid(value: unknown): void {
  if (value !== null) throw new Error("invalid desktop void response");
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new Error("invalid desktop boolean response");
  return value;
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
  ...createCredentialApi(call),
  createVault: (vaultName, password) =>
    call(
      "create_vault",
      (value) => (value === null ? null : parseVaultSnapshot(value)),
      { vaultName, password },
    ),
  unlockVault: (password) =>
    call("unlock_vault", parseVaultSnapshot, { password }),
  unlockVaultWithKeyfile: (password) =>
    call("unlock_vault_with_keyfile", parseVaultSnapshot, { password }),
  getVaultSnapshot: () => call("vault_snapshot", parseVaultSnapshot),
  saveVault: () => call("save_vault", parseCleanVaultSnapshot),
  exportVaultCopy: () => call("export_vault_copy", parseBoolean),
  getDatabaseMetadata: () => call("database_metadata", parseDatabaseMetadata),
  updateDatabaseMetadata: (name, description, defaultUsername) =>
    call("update_database_metadata", parseDatabaseMetadataUpdateReceipt, {
      name,
      description,
      defaultUsername,
    }),
  getHistoryPolicy: () => call("history_policy", parseHistoryPolicy),
  setHistoryMaxItems: (maxItems) =>
    call("set_history_max_items", parseHistoryPolicyUpdateReceipt, {
      maxItems,
    }),
  setRecycleBinEnabled: (enabled) =>
    call("set_recycle_bin_enabled", parseVaultSnapshot, { enabled }),
  reloadVault: (password) =>
    call("reload_vault", parseCleanVaultSnapshot, { password }),
  getPasswordHealthReport: () =>
    call("password_health_report", parsePasswordHealthReport),
  getEntryDetail: (entryId) =>
    call("entry_detail", parseEntryDetail, { entryId }),
  getEntryAttachments: (entryId) =>
    call("entry_attachments", parseEntryAttachments, { entryId }),
  importEntryCustomIcon: (entryId) =>
    call(
      "import_entry_custom_icon",
      (value) => (value === null ? null : parseVaultSnapshot(value)),
      { entryId },
    ),
  importEntryAttachment: (entryId) =>
    call(
      "import_entry_attachment",
      (value) => (value === null ? null : parseVaultSnapshot(value)),
      { entryId },
    ),
  exportEntryAttachment: (entryId, name) =>
    call(
      "export_entry_attachment",
      (value) => (value === null ? null : parseAttachmentExportReceipt(value)),
      { entryId, name },
    ),
  getEntryHistory: (entryId) =>
    call("entry_history", parseEntryHistory, { entryId }),
  restoreEntryHistory: (entryId, historyIndex, expectedDocumentRevision) =>
    call("restore_entry_history", parseVaultSnapshot, {
      entryId,
      historyIndex,
      expectedDocumentRevision,
    }),
  revealEntryPassword: (entryId) =>
    call("reveal_entry_password", parseSecretString, { entryId }),
  revealEntryNotes: (entryId) =>
    call("reveal_entry_notes", parseSecretString, { entryId }),
  revealEntryTotp: (entryId) =>
    call("reveal_entry_totp", parseTotpCode, { entryId }),
  revealEntryTitle: (entryId) =>
    call("reveal_entry_title", parseSecretString, { entryId }),
  revealEntryUsername: (entryId) =>
    call("reveal_entry_username", parseSecretString, { entryId }),
  revealEntryUrl: (entryId) =>
    call("reveal_entry_url", parseSecretString, { entryId }),
  openEntryUrl: (entryId) => call("open_entry_url", parseVoid, { entryId }),
  revealEntryCustomField: (entryId, name) =>
    call("reveal_entry_custom_field", parseSecretString, { entryId, name }),
  ...createClipboardApi(call),
  updateEntry: (request) =>
    call("update_entry", parseVaultSnapshot, { request }),
  setEntryTags: (entryId, tags) =>
    call("set_entry_tags", parseVaultSnapshot, { request: { entryId, tags } }),
  createEntry: (request) =>
    call("create_entry", parseCreatedEntry, { request }),
  duplicateEntry: (entryId) =>
    call("duplicate_entry", parseCreatedEntry, { entryId }),
  deleteEntry: (entryId) =>
    call("delete_entry", parseVaultSnapshot, { entryId }),
  restoreEntry: (entryId) =>
    call("restore_entry", parseVaultSnapshot, { entryId }),
  permanentlyDeleteEntry: (entryId) =>
    call("permanently_delete_entry", parseVaultSnapshot, { entryId }),
  moveEntry: (entryId, destinationGroupId) =>
    call("move_entry", parseVaultSnapshot, {
      request: { entryId, destinationGroupId },
    }),
  moveEntries: (entryIds, destinationGroupId) =>
    call("move_entries", parseVaultSnapshot, {
      request: { entryIds, destinationGroupId },
    }),
  trashEntries: (entryIds) =>
    call("trash_entries", parseVaultSnapshot, { request: { entryIds } }),
  restoreEntries: (entryIds) =>
    call("restore_entries", parseVaultSnapshot, { request: { entryIds } }),
  permanentlyDeleteEntries: (entryIds) =>
    call("permanently_delete_entries", parseVaultSnapshot, {
      request: { entryIds },
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
  restoreGroup: (groupId) =>
    call("restore_group", parseVaultSnapshot, { groupId }),
  permanentlyDeleteGroup: (groupId) =>
    call("permanently_delete_group", parseVaultSnapshot, { groupId }),
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
