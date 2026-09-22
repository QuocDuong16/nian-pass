import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { EntrySummaryDto, GroupDto } from "../../types/desktop";
import { isEntryExpired } from "./entry-expiry";
import { Summary } from "./summary";

interface EntryListProps {
  group: GroupDto;
  entries: EntrySummaryDto[];
  selectedEntryId: string | null;
  onSelect: (entryId: string) => void;
  selectionMode?: boolean;
  selectedEntryIds?: ReadonlySet<string>;
  onToggleSelection?: (entryId: string) => void;
  heading?: string | undefined;
  eyebrow?: string;
  emptyMessage?: string;
  hideHeader?: boolean;
}

function navigationIndex(
  key: string,
  currentIndex: number,
  length: number,
): number | null {
  switch (key) {
    case "ArrowDown":
      return Math.min(currentIndex + 1, length - 1);
    case "ArrowUp":
      return Math.max(currentIndex - 1, 0);
    case "Home":
      return 0;
    case "End":
      return Math.max(length - 1, 0);
    default:
      return null;
  }
}

export function EntryList({
  group,
  entries,
  selectedEntryId,
  onSelect,
  selectionMode = false,
  selectedEntryIds = new Set<string>(),
  onToggleSelection,
  heading,
  eyebrow = "Selected group",
  emptyMessage = "No entries in this group.",
  hideHeader = false,
}: EntryListProps) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const navigate = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentEntryId: string,
  ) => {
    const currentIndex = entries.findIndex(
      (entry) => entry.id === currentEntryId,
    );
    const nextIndex = navigationIndex(event.key, currentIndex, entries.length);
    if (currentIndex < 0 || nextIndex === null) return;
    const nextEntry = entries[nextIndex];
    if (nextEntry === undefined) return;

    event.preventDefault();
    rowRefs.current.get(nextEntry.id)?.focus();
    if (!selectionMode && nextEntry.id !== currentEntryId) {
      onSelect(nextEntry.id);
    }
  };

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
                  (
                    selectionMode
                      ? selectedEntryIds.has(entry.id)
                      : entry.id === selectedEntryId
                  )
                    ? `entry-row selected${selectionMode ? " selecting" : ""}`
                    : `entry-row${selectionMode ? " selecting" : ""}`
                }
                type="button"
                role={selectionMode ? "checkbox" : undefined}
                aria-current={
                  !selectionMode && entry.id === selectedEntryId
                    ? "true"
                    : undefined
                }
                aria-checked={
                  selectionMode ? selectedEntryIds.has(entry.id) : undefined
                }
                ref={(element) => {
                  if (element === null) rowRefs.current.delete(entry.id);
                  else rowRefs.current.set(entry.id, element);
                }}
                onKeyDown={(event) => {
                  navigate(event, entry.id);
                }}
                onClick={() => {
                  if (selectionMode) {
                    onToggleSelection?.(entry.id);
                    return;
                  }
                  onSelect(entry.id);
                }}
              >
                {selectionMode ? (
                  <span
                    className="entry-selection-indicator"
                    aria-hidden="true"
                  >
                    {selectedEntryIds.has(entry.id) ? "✓" : ""}
                  </span>
                ) : null}
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
                <span className="presence-row" aria-label="Entry metadata">
                  {entry.passwordPresent ? <span>Password stored</span> : null}
                  {entry.notesPresent ? <span>Notes stored</span> : null}
                  {entry.totpPresent ? <span>TOTP</span> : null}
                  {entry.expiresAtUnixSeconds !== null ? (
                    <span>
                      {isEntryExpired(entry.expiresAtUnixSeconds)
                        ? "Expired"
                        : "Expiry set"}
                    </span>
                  ) : null}
                  {entry.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="entry-tag">
                      {tag}
                    </span>
                  ))}
                  {entry.tags.length > 2 ? (
                    <span className="entry-tag-overflow">
                      +{entry.tags.length - 2} tags
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
