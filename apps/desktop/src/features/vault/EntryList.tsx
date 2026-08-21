import type { EntrySummaryDto, GroupDto } from "../../types/desktop";
import { Summary } from "./summary";

interface EntryListProps {
  group: GroupDto;
  entries: EntrySummaryDto[];
  selectedEntryId: string | null;
  onSelect: (entryId: string) => void;
}

export function EntryList({
  group,
  entries,
  selectedEntryId,
  onSelect,
}: EntryListProps) {
  return (
    <section className="entry-pane" aria-labelledby="entries-title">
      <header className="entry-heading">
        <div>
          <p className="eyebrow">Selected group</p>
          <h2 id="entries-title">{group.name || "Unnamed group"}</h2>
        </div>
        <span className="entry-count">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </header>

      {entries.length === 0 ? (
        <div className="empty-state">No entries in this group.</div>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                className={
                  entry.id === selectedEntryId
                    ? "entry-card selected"
                    : "entry-card"
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
