import { DesktopCommandError } from "../../lib/desktop";

export function syncErrorMessage(reason: unknown): string {
  if (!(reason instanceof DesktopCommandError)) {
    return "Synchronization failed safely.";
  }
  if (reason.code === "unsaved_changes") return "Save before syncing.";
  if (reason.code === "sync_remote_changed") {
    return "The remote vault changed. Sync again to replan.";
  }
  if (reason.code === "sync_local_changed") {
    return "The local vault changed. Sync again to replan.";
  }
  if (reason.code === "sync_local_changed_during_recovery") {
    return "Local vault changed while sync recovery was pending.";
  }
  if (reason.code === "sync_recovery_required") {
    return "Sync recovery required. Re-enter credentials to continue.";
  }
  if (
    reason.code === "sync_unsupported_provider" ||
    reason.code === "sync_unsafe_provider"
  ) {
    return "This provider cannot prove safe conditional-write behavior.";
  }
  if (reason.code === "sync_credentials_required") {
    return "Provider credentials and the vault master password are required.";
  }
  if (reason.code === "operation_in_progress") {
    return "Another vault operation is already in progress.";
  }
  return "Synchronization failed safely.";
}
