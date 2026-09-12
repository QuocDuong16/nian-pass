import { Button } from "../../components/Button";
import type { EntrySummaryDto, GroupDto } from "../../types/desktop";
import { EntryList } from "./EntryList";

interface VaultEntryPaneProps {
  group: GroupDto;
  entries: EntrySummaryDto[];
  selectedEntryId: string | null;
  searchActive: boolean;
  disabled: boolean;
  onNewEntry: () => void;
  onSelectEntry: (entryId: string) => void;
}

export function VaultEntryPane(props: VaultEntryPaneProps) {
  return (
    <div className="entry-column">
      <div className="entry-toolbar">
        <div className="entry-toolbar-context">
          <h2>
            {props.searchActive
              ? "Search results"
              : props.group.name || "Unnamed group"}
          </h2>
          <span>
            {props.searchActive
              ? `${String(props.entries.length)} results`
              : `${String(props.entries.length)} ${props.entries.length === 1 ? "entry" : "entries"}`}
          </span>
        </div>
        <Button
          size="sm"
          variant="primary"
          type="button"
          disabled={props.disabled}
          onClick={props.onNewEntry}
        >
          + New entry
        </Button>
      </div>
      <EntryList
        group={props.group}
        entries={props.entries}
        selectedEntryId={props.selectedEntryId}
        onSelect={props.onSelectEntry}
        eyebrow={props.searchActive ? "Global search" : "Selected group"}
        heading={props.searchActive ? "Search results" : undefined}
        hideHeader
        emptyMessage={
          props.searchActive
            ? "No matching entries."
            : "No entries in this group."
        }
      />
    </div>
  );
}
