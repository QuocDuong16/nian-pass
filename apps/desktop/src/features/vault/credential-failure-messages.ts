import { DesktopCommandError } from "../../lib/desktop";

export function rotationFailureMessage(error: unknown): string {
  if (error instanceof DesktopCommandError) {
    if (error.code === "unsaved_changes") {
      return "Save or discard unsaved vault changes before changing the master password.";
    }
    if (error.code === "external_change") {
      return "The vault changed on disk. Reload it before changing the master password.";
    }
    if (error.code === "unsupported_persistence_platform") {
      return "Credential changes are not supported safely on this platform yet.";
    }
    if (error.code === "save_uncertain") {
      return "Credential rewrite durability is uncertain. Lock and reopen the vault before relying on the new password.";
    }
  }
  return "Could not change the master password. The existing vault and credential remain in use.";
}

export function removalFailureMessage(error: unknown): string {
  if (error instanceof DesktopCommandError) {
    if (error.code === "unsaved_changes") {
      return "Save or discard unsaved vault changes before removing the master password.";
    }
    if (error.code === "external_change") {
      return "The vault changed on disk. Reload it before removing the master password.";
    }
    if (error.code === "invalid_request") {
      return "A retained keyfile and master password are required to remove the password.";
    }
    if (error.code === "unsupported_persistence_platform") {
      return "Credential changes are not supported safely on this platform yet.";
    }
    if (error.code === "save_uncertain") {
      return "Credential rewrite durability is uncertain. Lock and reopen the vault with the credential proven on disk before relying on this change.";
    }
  }
  return "Could not remove the master password. Reopen the vault to confirm which credential is active.";
}
