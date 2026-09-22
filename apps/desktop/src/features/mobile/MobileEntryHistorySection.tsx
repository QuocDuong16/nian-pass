import { useState } from "react";

import type {
  EntryHistoryDto,
  EntryHistoryItemDto,
  EntryId,
} from "../../types/desktop";
import type { MobileApi } from "../../types/mobile";
import { Summary } from "../vault/summary";

interface Props {
  api: MobileApi;
  entryId: EntryId;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}

export function MobileEntryHistorySection({
  api,
  entryId,
  disabled,
  onBusyChange,
}: Props) {
  const [history, setHistory] = useState<EntryHistoryDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    if (disabled || loading) return;
    setLoading(true);
    setFailed(false);
    onBusyChange(true);
    try {
      setHistory(await api.getEntryHistory(entryId));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      onBusyChange(false);
    }
  };

  return (
    <section className="detail-field" aria-labelledby="mobile-history-label">
      <div className="history-heading">
        <h3 id="mobile-history-label">Entry history</h3>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => {
            void load();
          }}
        >
          {loading ? "Loading…" : history === null ? "Load history" : "Refresh"}
        </button>
      </div>
      {history === null && !failed ? (
        <p className="secret-placeholder">
          History is loaded only when requested.
        </p>
      ) : null}
      {failed ? (
        <p className="detail-error" role="alert">
          Could not load entry history.
        </p>
      ) : null}
      {history !== null && history.items.length === 0 ? (
        <p className="secret-placeholder">No previous revisions.</p>
      ) : null}
      {history !== null && history.items.length > 0 ? (
        <ol className="history-list">
          {history.items.map((item) => (
            <HistoryRow key={item.index} item={item} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function HistoryRow({ item }: { item: EntryHistoryItemDto }) {
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
      <span className="secret-placeholder">
        {item.restorable
          ? "Restore available on desktop"
          : "Restore unavailable"}
      </span>
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
