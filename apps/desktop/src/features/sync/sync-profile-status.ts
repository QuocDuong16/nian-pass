import type { SyncProfileDto } from "../../lib/sync";

export function syncProfileStatus(
  status: SyncProfileDto["recoveryStatus"],
): string {
  switch (status) {
    case "required":
      return "Sync recovery required.";
    case "unsupported":
      return "Older or unsupported sync metadata must be reset explicitly.";
    case "none":
      return "Idle";
  }
}
