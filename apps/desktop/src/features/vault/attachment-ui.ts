import { DesktopCommandError } from "../../lib/desktop";

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function attachmentErrorMessage(
  error: unknown,
  action: "import" | "export",
): string {
  if (!(error instanceof DesktopCommandError)) {
    return `Could not ${action} the attachment.`;
  }
  if (error.code === "attachment_already_exists") {
    return "An attachment with this filename already exists. Rename the source file or delete the existing attachment first.";
  }
  if (error.code === "attachment_too_large") {
    return "Attachments larger than 64 MiB cannot be imported.";
  }
  if (error.code === "attachment_not_found") {
    return "That attachment is no longer available. Reload attachments and try again.";
  }
  if (error.code === "attachment_io_failed") {
    return `Could not ${action} the attachment file.`;
  }
  return `Could not ${action} the attachment.`;
}
