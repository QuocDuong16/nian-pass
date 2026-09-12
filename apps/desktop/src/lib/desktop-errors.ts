import type { DesktopErrorCode } from "../types/desktop";

const codes: readonly DesktopErrorCode[] = [
  "already_unlocked",
  "locked",
  "no_vault_selected",
  "unlock_failed",
  "unsupported_vault",
  "vault_create_failed",
  "vault_already_exists",
  "entry_not_found",
  "group_not_found",
  "invalid_request",
  "invalid_move",
  "reserved_field",
  "secret_unavailable",
  "unsaved_changes",
  "save_failed",
  "save_authentication_failed",
  "save_uncertain",
  "unsupported_write_format",
  "unsupported_persistence_platform",
  "read_only_source",
  "external_change",
  "reload_failed",
  "clipboard_failed",
  "internal",
  "operation_in_progress",
  "sync_failed",
  "sync_remote_changed",
  "sync_local_changed",
  "sync_local_changed_during_recovery",
  "sync_recovery_required",
  "sync_state_unsupported",
  "sync_state_corrupt",
  "sync_unsupported_provider",
  "sync_unsafe_provider",
  "sync_credentials_required",
];

export function parseDesktopErrorCode(value: unknown): DesktopErrorCode {
  const matched = codes.find((code) => code === value);
  if (matched === undefined) {
    throw new Error("Nian Pass received an invalid desktop contract");
  }
  return matched;
}
