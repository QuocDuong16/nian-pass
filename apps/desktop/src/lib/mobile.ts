import { invoke } from "@tauri-apps/api/core";

import type {
  MobileApi,
  MobileErrorCode,
  MobileSelectedVaultDto,
} from "../types/mobile";
import {
  parseAutofillCandidates,
  parseAutofillLaunch,
  parseAutofillStatus,
} from "./mobile-autofill";
import {
  parseMobileSecurityAcknowledgement,
  parseMobileSecurityResume,
} from "./mobile-security-validation";
import { parseEntryDetail, parseSecretString } from "./entry-validation";
import {
  nonEmptyString,
  parseCreatedEntry,
  parseCreatedGroup,
  parseVaultSnapshot,
  record,
} from "./validation";

const mobileErrorCodes = new Set<MobileErrorCode>([
  "picker_failed",
  "source_unavailable",
  "no_vault_selected",
  "unlock_failed",
  "unsupported_vault",
  "entry_not_found",
  "group_not_found",
  "invalid_request",
  "conflict",
  "secret_unavailable",
  "locked",
  "unsaved_changes",
  "busy",
  "save_failed",
  "save_authentication_failed",
  "external_change",
  "save_uncertain",
  "persistence_unsupported",
  "recovery_required",
  "reload_failed",
  "reload_authentication_failed",
  "autofill_unavailable",
  "autofill_not_configured",
  "autofill_refresh_failed",
  "credential_unavailable",
  "internal",
]);

export class MobileCommandError extends Error {
  readonly code: MobileErrorCode;
  constructor(code: MobileErrorCode) {
    super("Nian Pass mobile command failed");
    this.name = "MobileCommandError";
    this.code = code;
  }
}

export function parseMobileErrorCode(value: unknown): MobileErrorCode {
  if (
    typeof value === "string" &&
    mobileErrorCodes.has(value as MobileErrorCode)
  )
    return value as MobileErrorCode;
  throw new Error("invalid mobile error code");
}

function toMobileError(error: unknown): MobileCommandError {
  if (error instanceof MobileCommandError) return error;
  if (typeof error === "object" && error !== null && "code" in error) {
    try {
      return new MobileCommandError(
        parseMobileErrorCode(Reflect.get(error, "code")),
      );
    } catch {
      return new MobileCommandError("internal");
    }
  }
  return new MobileCommandError("internal");
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
    throw toMobileError(error);
  }
  try {
    return parse(value);
  } catch {
    throw new MobileCommandError("internal");
  }
}

function parseVoid(value: unknown): void {
  if (value !== null) throw new Error("invalid mobile void response");
}

function parseMobileSelection(value: unknown): MobileSelectedVaultDto {
  const object = record(value, ["fileName", "writable"]);
  if (typeof object["writable"] !== "boolean")
    throw new Error("invalid mobile selection");
  return {
    fileName: nonEmptyString(object["fileName"]),
    writable: object["writable"],
  };
}

export const mobileApi: MobileApi = {
  selectVault: () =>
    call("mobile_select_vault", (value) =>
      value === null ? null : parseMobileSelection(value),
    ),
  unlockVault: (password) =>
    call("mobile_unlock_vault", parseVaultSnapshot, { password }),
  getVaultSnapshot: () => call("mobile_vault_snapshot", parseVaultSnapshot),
  getEntryDetail: (entryId) =>
    call("mobile_entry_detail", parseEntryDetail, { entryId }),
  revealEntryTitle: (entryId) =>
    call("mobile_load_entry_title", parseSecretString, { entryId }),
  revealEntryUsername: (entryId) =>
    call("mobile_load_entry_username", parseSecretString, { entryId }),
  revealEntryUrl: (entryId) =>
    call("mobile_load_entry_url", parseSecretString, { entryId }),
  revealEntryNotes: (entryId) =>
    call("mobile_load_entry_notes", parseSecretString, { entryId }),
  revealEntryCustomField: (entryId, name) =>
    call("mobile_load_entry_custom_field", parseSecretString, {
      entryId,
      name,
    }),
  updateEntry: (request) =>
    call("mobile_update_entry", parseVaultSnapshot, { request }),
  createEntry: (request) =>
    call("mobile_create_entry", parseCreatedEntry, { request }),
  deleteEntry: (entryId) =>
    call("mobile_delete_entry", parseVaultSnapshot, { entryId }),
  moveEntry: (entryId, destinationGroupId) =>
    call("mobile_move_entry", parseVaultSnapshot, {
      request: { entryId, destinationGroupId },
    }),
  createGroup: (parentGroupId, name) =>
    call("mobile_create_group", parseCreatedGroup, {
      request: { parentGroupId, name },
    }),
  renameGroup: (groupId, name) =>
    call("mobile_rename_group", parseVaultSnapshot, {
      request: { groupId, name },
    }),
  moveGroup: (groupId, destinationGroupId) =>
    call("mobile_move_group", parseVaultSnapshot, {
      request: { groupId, destinationGroupId },
    }),
  deleteGroup: (groupId) =>
    call("mobile_delete_group", parseVaultSnapshot, { groupId }),
  setEntryCustomField: (request) =>
    call("mobile_set_entry_custom_field", parseVaultSnapshot, { request }),
  deleteEntryCustomField: (entryId, name) =>
    call("mobile_delete_entry_custom_field", parseVaultSnapshot, {
      entryId,
      name,
    }),
  saveVault: (password) =>
    call("mobile_save_vault", parseVaultSnapshot, { password }),
  reloadVault: (password) =>
    call("mobile_reload_vault", parseVaultSnapshot, { password }),
  lockVault: () => call("mobile_lock_vault", parseVoid),
  discardChangesAndLock: () =>
    call("mobile_discard_changes_and_lock", parseVoid),
  securityResume: () =>
    call("mobile_security_resume", parseMobileSecurityResume),
  acknowledgeSafeUi: (generation) =>
    call(
      "mobile_security_acknowledge_safe_ui",
      parseMobileSecurityAcknowledgement,
      { generation },
    ),
  getAutofillStatus: () => call("mobile_autofill_status", parseAutofillStatus),
  enableAutofill: () =>
    call("mobile_enable_autofill_for_vault", parseAutofillStatus),
  disableAutofill: () =>
    call("mobile_disable_autofill_for_vault", parseAutofillStatus),
  refreshAutofill: () =>
    call("mobile_refresh_ios_autofill_mirror", parseAutofillStatus),
  getAutofillRequest: () =>
    call("mobile_autofill_request", (value) =>
      value === null ? null : parseAutofillLaunch(value),
    ),
  getAutofillCandidates: (requestToken) =>
    call("mobile_autofill_candidates", parseAutofillCandidates, {
      requestToken,
    }),
  publishAutofillCandidates: (requestToken) =>
    call("mobile_autofill_publish_candidates", parseVoid, { requestToken }),
  approveAutofill: (requestToken, entryId, approved) =>
    call("mobile_autofill_approve", parseVoid, {
      requestToken,
      entryId,
      approved,
    }),
  cancelAutofill: (requestToken) =>
    call("mobile_autofill_cancel", parseVoid, { requestToken }),
  openAutofillSettings: () => call("mobile_open_autofill_settings", parseVoid),
};
