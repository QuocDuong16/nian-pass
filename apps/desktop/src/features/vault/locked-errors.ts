import { DesktopCommandError } from "../../lib/desktop";
import type { DesktopErrorCode } from "../../types/desktop";

export function lockedOperationMessage(code: DesktopErrorCode): string {
  switch (code) {
    case "unlock_failed":
      return "Could not unlock this vault. Check the password and try again.";
    case "unsupported_vault":
      return "This file is not a supported KDBX vault.";
    case "vault_already_exists":
      return "A file already exists at that location. Choose a different save location.";
    case "vault_create_failed":
      return "Nian Pass could not safely create the vault at that location.";
    case "already_unlocked":
      return "Lock the current vault before opening another one.";
    case "unsupported_write_format":
    case "unsupported_persistence_platform":
    case "read_only_source":
    case "entry_not_found":
    case "group_not_found":
    case "invalid_request":
    case "invalid_move":
    case "reserved_field":
    case "secret_unavailable":
    case "unsaved_changes":
    case "save_failed":
    case "save_authentication_failed":
    case "save_uncertain":
    case "external_change":
    case "reload_failed":
    case "clipboard_failed":
    case "locked":
    case "no_vault_selected":
    case "internal":
    case "operation_in_progress":
    case "sync_failed":
    case "sync_remote_changed":
    case "sync_local_changed":
    case "sync_local_changed_during_recovery":
    case "sync_recovery_required":
    case "sync_state_unsupported":
    case "sync_state_corrupt":
    case "sync_unsupported_provider":
    case "sync_unsafe_provider":
    case "sync_credentials_required":
      return "Nian Pass could not complete that vault operation. Try again.";
  }
}

export function lockedErrorCode(error: unknown): DesktopErrorCode {
  return error instanceof DesktopCommandError ? error.code : "internal";
}
