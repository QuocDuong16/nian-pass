import { useMemo, useState } from "react";

import { Button } from "../../components/Button";
import type { DesktopApi } from "../../lib/desktop";
import type {
  EntrySummaryDto,
  GroupDto,
  VaultSnapshotDto,
} from "../../types/desktop";
import { BulkEntryActionDialog } from "./BulkEntryActionDialog";
import { EntryList } from "./EntryList";
import { sortEntriesForPresentation, type EntrySortMode } from "./entry-sort";
import { useBulkEntryActions } from "./useBulkEntryActions";

interface VaultEntryPaneProps {
  api: DesktopApi;
  group: GroupDto;
  entries: EntrySummaryDto[];
  activeGroups: GroupDto[];
  selectedEntryId: string | null;
  searchActive: boolean;
  disabled: boolean;
  bulkDisabled: boolean;
  recycled?: boolean;
  recycleBinEnabled: boolean;
  onNewEntry: () => void;
  onSelectEntry: (entryId: string) => void;
  onSelectionStart: () => void;
  onBusyChange: (busy: boolean) => void;
  onBulkChanged: (
    snapshot: VaultSnapshotDto,
    destinationGroupId?: string,
  ) => void;
}

export function VaultEntryPane(props: VaultEntryPaneProps) {
  const [sortMode, setSortMode] = useState<EntrySortMode>("database");
  const displayedEntries = useMemo(
    () => sortEntriesForPresentation(props.entries, sortMode),
    [props.entries, sortMode],
  );
  const bulk = useBulkEntryActions({
    api: props.api,
    availableEntryIds: props.entries.map((entry) => entry.id),
    onBusyChange: props.onBusyChange,
    onChanged: props.onBulkChanged,
    onSelectionStart: props.onSelectionStart,
  });
  const canStartBulk =
    !props.searchActive && !props.bulkDisabled && props.entries.length > 0;

  return (
    <div className="entry-column">
      <div className="entry-toolbar">
        <div className="entry-toolbar-context">
          <h2>
            {props.searchActive
              ? "Search results"
              : props.recycled === true
                ? "Trash"
                : props.group.name || "Unnamed group"}
          </h2>
          <div className="entry-toolbar-meta">
            <span>
              {props.searchActive
                ? `${String(props.entries.length)} ${props.entries.length === 1 ? "result" : "results"}`
                : `${String(props.entries.length)} ${props.entries.length === 1 ? "entry" : "entries"}`}
            </span>
            {bulk.selectionMode ? null : (
              <select
                className="entry-sort-select"
                aria-label="Sort entries"
                value={sortMode}
                onChange={(event) => {
                  setSortMode(event.target.value as EntrySortMode);
                }}
              >
                <option value="database">Database</option>
                <option value="title_asc">Title A–Z</option>
                <option value="title_desc">Title Z–A</option>
                <option value="username_asc">Username A–Z</option>
                <option value="url_asc">URL A–Z</option>
                <option value="expiry_asc">Expiry soon</option>
              </select>
            )}
          </div>
        </div>
        <div className="entry-toolbar-actions">
          {bulk.selectionMode ? (
            <>
              <span className="entry-count">
                {String(bulk.selectedCount)} selected
              </span>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                disabled={bulk.busy}
                onClick={bulk.selectAll}
              >
                Select all
              </Button>
              {props.recycled === true ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    disabled={bulk.busy || bulk.selectedCount === 0}
                    onClick={bulk.openRestore}
                  >
                    Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    type="button"
                    disabled={bulk.busy || bulk.selectedCount === 0}
                    onClick={bulk.openPermanentDelete}
                  >
                    Delete permanently
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    disabled={bulk.busy || bulk.selectedCount === 0}
                    onClick={bulk.openMove}
                  >
                    Move
                  </Button>
                  {props.recycleBinEnabled ? (
                    <Button
                      size="sm"
                      variant="danger"
                      type="button"
                      disabled={bulk.busy || bulk.selectedCount === 0}
                      onClick={bulk.openTrash}
                    >
                      Move to Trash
                    </Button>
                  ) : null}
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                type="button"
                disabled={bulk.busy}
                onClick={bulk.cancel}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              {canStartBulk ? (
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={bulk.start}
                >
                  Select
                </Button>
              ) : null}
              {props.recycled === true ? null : (
                <Button
                  size="sm"
                  variant="primary"
                  type="button"
                  disabled={props.disabled}
                  onClick={props.onNewEntry}
                >
                  + New entry
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {props.searchActive ? (
        <p className="search-filter-help">
          Filters: <code>tag:work</code> · <code>group:Work</code> ·{" "}
          <code>has:totp</code> · <code>has:password</code> ·{" "}
          <code>has:notes</code> · <code>is:expired</code> ·{" "}
          <code>is:expiring</code> (next 30 days) · <code>is:protected</code>.
          Combine filters with text; quote multi-word values.
        </p>
      ) : null}
      <EntryList
        group={props.group}
        entries={displayedEntries}
        selectedEntryId={props.selectedEntryId}
        onSelect={props.onSelectEntry}
        selectionMode={bulk.selectionMode}
        selectedEntryIds={bulk.selectedEntryIds}
        onToggleSelection={bulk.toggle}
        eyebrow={props.searchActive ? "Global search" : "Selected group"}
        heading={props.searchActive ? "Search results" : undefined}
        hideHeader
        emptyMessage={
          props.searchActive
            ? "No matching entries."
            : "No entries in this group."
        }
      />
      {bulk.error !== null && bulk.dialog === null ? (
        <p className="shell-error bulk-entry-error" role="alert">
          {bulk.error}
        </p>
      ) : null}
      {bulk.dialog === null ? null : (
        <BulkEntryActionDialog
          key={bulk.dialog}
          kind={bulk.dialog}
          count={bulk.selectedCount}
          groups={props.activeGroups}
          currentGroupId={props.group.id}
          busy={bulk.busy}
          error={bulk.error}
          onCancel={bulk.closeDialog}
          onMove={bulk.confirmMove}
          onTrash={bulk.confirmTrash}
          onRestore={bulk.confirmRestore}
          onPermanentDelete={bulk.confirmPermanentDelete}
        />
      )}
    </div>
  );
}
