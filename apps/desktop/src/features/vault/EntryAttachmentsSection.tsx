import { useState } from "react";

import { Button } from "../../components/Button";
import { DesktopCommandError, type DesktopApi } from "../../lib/desktop";
import type {
  EntryAttachmentSummaryDto,
  VaultSnapshotDto,
} from "../../types/desktop";
import { attachmentErrorMessage, formatAttachmentSize } from "./attachment-ui";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";

interface EntryAttachmentsSectionProps {
  api: DesktopApi;
  entryId: string;
  disabled: boolean;
  mutationDisabled: boolean;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function EntryAttachmentsSection({
  api,
  entryId,
  disabled,
  mutationDisabled,
  onSnapshot,
  onBusyChange,
}: EntryAttachmentsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<EntryAttachmentSummaryDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useSecurityFormTelemetry(false, busy, undefined, onBusyChange);

  const load = async () => {
    if (loading) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      setItems(await api.getEntryAttachments(entryId));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const importAttachment = async () => {
    if (disabled || mutationDisabled || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const snapshot = await api.importEntryAttachment(entryId);
      if (snapshot === null) {
        setStatus("Import cancelled.");
      } else {
        onSnapshot(snapshot);
      }
    } catch (error: unknown) {
      setStatus(attachmentErrorMessage(error, "import"));
    } finally {
      setBusy(false);
    }
  };

  const exportAttachment = async (item: EntryAttachmentSummaryDto) => {
    if (disabled || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const receipt = await api.exportEntryAttachment(entryId, item.name);
      setStatus(
        receipt === null ? "Export cancelled." : "Attachment exported.",
      );
    } catch (error: unknown) {
      setStatus(attachmentErrorMessage(error, "export"));
      if (
        error instanceof DesktopCommandError &&
        error.code === "attachment_not_found"
      ) {
        setItems(null);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="detail-field entry-attachments"
      aria-labelledby="attachments-label"
    >
      <div className="history-heading-row">
        <h3 id="attachments-label">Attachments</h3>
        <div className="detail-actions">
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={disabled || mutationDisabled || busy}
            onClick={() => void importAttachment()}
          >
            {busy ? "Working…" : "Import"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            aria-expanded={expanded}
            onClick={() => {
              const next = !expanded;
              setExpanded(next);
              if (next && items === null && !loading) void load();
            }}
          >
            {expanded ? "Hide" : "Show"}
          </Button>
        </div>
      </div>
      {expanded ? (
        <div className="attachment-content">
          {loading ? (
            <p className="detail-loading">Loading attachments…</p>
          ) : null}
          {loadFailed ? (
            <div className="history-message" role="alert">
              <span>Could not load attachments.</span>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => void load()}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {items !== null && items.length === 0 ? (
            <p className="secret-placeholder">No attachments.</p>
          ) : null}
          {items !== null && items.length > 0 ? (
            <ul className="attachment-list">
              {items.map((item) => (
                <li className="attachment-row" key={item.name}>
                  <div className="attachment-meta">
                    <strong>{item.name || "Unnamed attachment"}</strong>
                    <span>
                      {formatAttachmentSize(item.sizeBytes)}
                      {item.protected ? " · protected" : ""}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    disabled={disabled || busy}
                    onClick={() => void exportAttachment(item)}
                  >
                    Export
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {status === null ? null : (
            <p className="copy-status" aria-live="polite">
              {status}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
