import type { EntrySummaryDto, GroupDto } from "../../types/desktop";
import { Summary } from "./summary";

interface EntryListProps {
  group: GroupDto;
  entries: EntrySummaryDto[];
  selectedEntryId: string | null;
  onSelect: (entryId: string) => void;
  heading?: string | undefined;
  eyebrow?: string;
  emptyMessage?: string;
  hideHeader?: boolean;
}

export function EntryList({
  group,
  entries,
  selectedEntryId,
  onSelect,
  heading,
  eyebrow = "Selected group",
  emptyMessage = "No entries in this group.",
  hideHeader = false,
}: EntryListProps) {
  const label = heading ?? (group.name || "Unnamed group");
  return (
    <section
      className={hideHeader ? "entry-pane entry-pane-compact" : "entry-pane"}
      aria-label={hideHeader ? label : undefined}
      aria-labelledby={hideHeader ? undefined : "entries-title"}
    >
      {hideHeader ? null : (
        <header className="entry-heading">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id="entries-title">{label}</h2>
          </div>
          <span className="entry-count">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
        </header>
      )}

      {entries.length === 0 ? (
        <div className="empty-state">{emptyMessage}</div>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                className={
                  entry.id === selectedEntryId
                    ? "entry-row selected"
                    : "entry-row"
                }
                type="button"
                onClick={() => {
                  onSelect(entry.id);
                }}
              >
                <strong className="entry-title">
                  <Summary
                    value={entry.title}
                    missingLabel="Untitled entry"
                    emptyLabel="Empty title"
                  />
                </strong>
                <span className="entry-meta">
                  <Summary
                    value={entry.username}
                    missingLabel="No username"
                    emptyLabel="Empty username"
                  />
                </span>
                <span className="entry-meta entry-url">
                  <Summary
                    value={entry.url}
                    missingLabel="No URL"
                    emptyLabel="Empty URL"
                  />
                </span>
                <span className="presence-row" aria-label="Available fields">
                  {entry.passwordPresent ? <span>Password stored</span> : null}
                  {entry.notesPresent ? <span>Notes stored</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
