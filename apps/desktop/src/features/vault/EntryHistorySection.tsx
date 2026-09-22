import { useState } from "react";

import { Button } from "../../components/Button";
import { DesktopCommandError, type DesktopApi } from "../../lib/desktop";
import type {
  EntryHistoryDto,
  EntryHistoryItemDto,
  VaultSnapshotDto,
} from "../../types/desktop";
import { EntryHistoryRestoreDialog } from "./EntryHistoryRestoreDialog";
import { Summary } from "./summary";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";

interface Props {
  api: DesktopApi;
  entryId: string;
  disabled: boolean;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onDraftChange?: (active: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function EntryHistorySection({
  api,
  entryId,
  disabled,
  onSnapshot,
  onDraftChange,
  onBusyChange,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<EntryHistoryDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<EntryHistoryItemDto | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useSecurityFormTelemetry(
    selected !== null,
    restoring,
    onDraftChange,
    onBusyChange,
  );

  const loadHistory = async () => {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    try {
      setHistory(await api.getEntryHistory(entryId));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const reload = () => {
    setHistory(null);
    setFailed(false);
    setRestoreError(null);
    void loadHistory();
  };

  const restore = async () => {
    if (selected === null || history === null || disabled || restoring) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const snapshot = await api.restoreEntryHistory(
        entryId,
        selected.index,
        history.documentRevision,
      );
      setSelected(null);
      setHistory(null);
      onSnapshot(snapshot);
    } catch (error: unknown) {
      setSelected(null);
      if (
        error instanceof DesktopCommandError &&
        error.code === "history_changed"
      ) {
        setHistory(null);
        setRestoreError(
          "History changed while it was open. Reload history and try again.",
        );
      } else if (
        error instanceof DesktopCommandError &&
        error.code === "history_restore_unsupported"
      ) {
        setRestoreError(
          "This revision contains attachment or custom-icon state that cannot be restored safely yet.",
        );
      } else {
        setRestoreError("Could not restore this history revision.");
      }
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section
      className="detail-field entry-history"
      aria-labelledby="entry-history-label"
    >
      <div className="history-heading-row">
        <h3 id="entry-history-label">History</h3>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next && history === null && !loading) void loadHistory();
          }}
        >
          {expanded ? "Hide" : "Show"}
        </Button>
      </div>
      {expanded ? (
        <div className="history-content">
          {loading ? <p className="detail-loading">Loading history…</p> : null}
          {failed ? (
            <div className="history-message" role="alert">
              <span>Could not load entry history.</span>
              <Button size="sm" variant="ghost" type="button" onClick={reload}>
                Retry
              </Button>
            </div>
          ) : null}
          {history !== null && history.items.length === 0 ? (
            <p className="secret-placeholder">No previous revisions.</p>
          ) : null}
          {history !== null && history.items.length > 0 ? (
            <ol className="history-list">
              {history.items.map((item) => (
                <HistoryRow
                  key={item.index}
                  item={item}
                  disabled={disabled || restoring}
                  onRestore={() => {
                    setRestoreError(null);
                    setSelected(item);
                  }}
                />
              ))}
            </ol>
          ) : null}
          {restoreError === null ? null : (
            <p className="detail-error" role="alert">
              {restoreError}
            </p>
          )}
        </div>
      ) : null}
      {selected === null ? null : (
        <EntryHistoryRestoreDialog
          busy={restoring}
          onCancel={() => {
            if (!restoring) setSelected(null);
          }}
          onRestore={() => {
            void restore();
          }}
        />
      )}
    </section>
  );
}

function HistoryRow({
  item,
  disabled,
  onRestore,
}: {
  item: EntryHistoryItemDto;
  disabled: boolean;
  onRestore: () => void;
}) {
  return (
    <li className="history-row">
      <div className="history-row-main">
        <strong>
          <Summary
            value={item.title}
            missingLabel="Untitled entry"
            emptyLabel="Empty title"
          />
        </strong>
        <span className="history-time">
          {formatHistoryTime(item.modifiedAtUnixSeconds)}
        </span>
        <span
          className="history-presence"
          aria-label="Stored fields in this revision"
        >
          {historyPresence(item)}
        </span>
      </div>
      <Button
        size="sm"
        variant="secondary"
        type="button"
        disabled={disabled || !item.restorable}
        title={
          item.restorable
            ? "Restore this revision"
            : "Attachment or custom-icon history cannot be restored safely yet"
        }
        onClick={onRestore}
      >
        Restore
      </Button>
    </li>
  );
}

function historyPresence(item: EntryHistoryItemDto): string {
  const fields = [
    item.passwordPresent ? "Password" : null,
    item.notesPresent ? "Notes" : null,
    item.totpPresent ? "TOTP" : null,
    item.tags.length > 0 ? `${String(item.tags.length)} tag(s)` : null,
  ].filter((value): value is string => value !== null);
  return fields.length === 0 ? "Metadata revision" : fields.join(" · ");
}

function formatHistoryTime(value: number | null): string {
  if (value === null) return "Time unavailable";
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : date.toLocaleString();
}
