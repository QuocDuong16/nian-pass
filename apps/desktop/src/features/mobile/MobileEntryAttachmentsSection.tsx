import { useState } from "react";

import type { EntryAttachmentSummaryDto, EntryId } from "../../types/desktop";
import type { MobileApi, MobileVaultSnapshotDto } from "../../types/mobile";
import { formatAttachmentSize } from "../vault/attachment-ui";

interface Props {
  api: MobileApi;
  entryId: EntryId;
  disabled: boolean;
  readOnly: boolean;
  nativeActions: boolean;
  onSnapshot: (snapshot: MobileVaultSnapshotDto) => void;
  onBusyChange: (busy: boolean) => void;
}

export function MobileEntryAttachmentsSection({
  api,
  entryId,
  disabled,
  readOnly,
  nativeActions,
  onSnapshot,
  onBusyChange,
}: Props) {
  const [items, setItems] = useState<EntryAttachmentSummaryDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = async () => {
    if (disabled || loading || working) return;
    setLoading(true);
    setFailed(false);
    onBusyChange(true);
    try {
      setItems(await api.getEntryAttachments(entryId));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      onBusyChange(false);
    }
  };

  const importAttachment = async () => {
    if (disabled || readOnly || !nativeActions || working || loading) return;
    setWorking(true);
    setStatus(null);
    onBusyChange(true);
    try {
      const snapshot = await api.importEntryAttachment(entryId);
      if (snapshot === null) {
        setStatus("Import cancelled.");
      } else {
        onSnapshot(snapshot);
        setItems(null);
        setStatus("Attachment imported. Reload attachments to review it.");
      }
    } catch {
      setStatus("Could not import the attachment.");
    } finally {
      setWorking(false);
      onBusyChange(false);
    }
  };

  const exportAttachment = async (item: EntryAttachmentSummaryDto) => {
    if (disabled || !nativeActions || working || loading) return;
    setWorking(true);
    setStatus(null);
    onBusyChange(true);
    try {
      const receipt = await api.exportEntryAttachment(entryId, item.name);
      setStatus(
        receipt === null ? "Export cancelled." : "Attachment exported.",
      );
    } catch {
      setStatus("Could not export the attachment.");
    } finally {
      setWorking(false);
      onBusyChange(false);
    }
  };

  return (
    <section
      className="detail-field"
      aria-labelledby="mobile-attachments-label"
    >
      <div className="history-heading-row">
        <h3 id="mobile-attachments-label">Attachments</h3>
        <div className="detail-actions">
          {nativeActions && !readOnly ? (
            <button
              type="button"
              disabled={disabled || loading || working}
              onClick={() => void importAttachment()}
            >
              {working ? "Working…" : "Import"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled || loading || working}
            onClick={() => void load()}
          >
            {loading
              ? "Loading…"
              : items === null
                ? "Load attachments"
                : "Refresh"}
          </button>
        </div>
      </div>
      {items === null && !failed ? (
        <p className="secret-placeholder">
          Attachment metadata is loaded only when requested.
        </p>
      ) : null}
      {failed ? (
        <p className="detail-error" role="alert">
          Could not load attachments.
        </p>
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
              {nativeActions ? (
                <button
                  type="button"
                  disabled={disabled || loading || working}
                  onClick={() => void exportAttachment(item)}
                >
                  Export
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!nativeActions ? (
        <p className="secret-placeholder">
          Import and export are unavailable on this platform.
        </p>
      ) : null}
      {status === null ? null : (
        <p className="copy-status" aria-live="polite">
          {status}
        </p>
      )}
    </section>
  );
}
