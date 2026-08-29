import { useEffect, useMemo, useRef, useState } from "react";

import type { EntryDetailDto, VaultSnapshotDto } from "../../types/desktop";
import type { MobileApi } from "../../types/mobile";
import { EntryCreateDialog } from "../vault/EntryCreateDialog";
import { EntryList } from "../vault/EntryList";
import { GroupActions } from "../vault/GroupActions";
import { GroupTree } from "../vault/GroupTree";
import { MobileEntryDetail } from "./MobileEntryDetail";

interface Props {
  api: MobileApi;
  snapshot: VaultSnapshotDto;
  disabled: boolean;
  readOnly?: boolean;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onDraftChange: (active: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}

export function MobileVaultBrowser(props: Props) {
  const { onBusyChange, onDraftChange } = props;
  const [selectedGroupId, setSelectedGroupId] = useState(
    props.snapshot.rootGroupId,
  );
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntryDetailDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [detailDraft, setDetailDraft] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [groupDraft, setGroupDraft] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const groupsById = useMemo(
    () => new Map(props.snapshot.groups.map((group) => [group.id, group])),
    [props.snapshot.groups],
  );
  const entriesById = useMemo(
    () => new Map(props.snapshot.entries.map((entry) => [entry.id, entry])),
    [props.snapshot.entries],
  );
  const selectedGroup =
    groupsById.get(selectedGroupId) ??
    groupsById.get(props.snapshot.rootGroupId);
  if (selectedGroup === undefined)
    throw new Error("Mobile vault snapshot has no root group");
  const entries = selectedGroup.entryIds.flatMap((id) => {
    const entry = entriesById.get(id);
    return entry === undefined ? [] : [entry];
  });

  useEffect(() => {
    onDraftChange(creating || detailDraft || groupDraft);
    return () => {
      onDraftChange(false);
    };
  }, [creating, detailDraft, groupDraft, onDraftChange]);
  useEffect(() => {
    onBusyChange(createBusy || detailBusy || groupBusy);
    return () => {
      onBusyChange(false);
    };
  }, [createBusy, detailBusy, groupBusy, onBusyChange]);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const loadDetail = async (entryId: string) => {
    const current = generation.current + 1;
    generation.current = current;
    setSelectedEntryId(entryId);
    setDetail(null);
    setError(null);
    try {
      const next = await props.api.getEntryDetail(entryId);
      if (generation.current === current) setDetail(next);
    } catch {
      if (generation.current === current) {
        setSelectedEntryId(null);
        setError("Could not load that entry.");
      }
    }
  };

  const acceptSnapshot = (
    next: VaultSnapshotDto,
    preferredEntry = selectedEntryId,
  ) => {
    props.onSnapshot(next);
    if (
      preferredEntry !== null &&
      next.entries.some((entry) => entry.id === preferredEntry)
    ) {
      void loadDetail(preferredEntry);
    } else {
      generation.current += 1;
      setSelectedEntryId(null);
      setDetail(null);
    }
  };

  return (
    <>
      {error === null ? null : (
        <p className="shell-error" role="alert">
          {error}
        </p>
      )}
      <div className="mobile-vault-layout">
        <div className="group-pane">
          <GroupTree
            rootGroupId={props.snapshot.rootGroupId}
            groupsById={groupsById}
            selectedGroupId={selectedGroup.id}
            onSelect={(groupId) => {
              if (!groupsById.has(groupId)) return;
              generation.current += 1;
              setSelectedGroupId(groupId);
              setSelectedEntryId(null);
              setDetail(null);
              setDetailDraft(false);
            }}
          />
          {props.readOnly === true ? null : (
            <GroupActions
              api={props.api}
              group={selectedGroup}
              snapshot={props.snapshot}
              disabled={props.disabled}
              onDraftChange={setGroupDraft}
              onBusyChange={setGroupBusy}
              onChanged={(next, groupId) => {
                setSelectedGroupId(groupId);
                acceptSnapshot(next, null);
              }}
            />
          )}
        </div>
        <div className="entry-column">
          {props.readOnly === true ? null : (
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => {
                setCreating(true);
              }}
            >
              New entry
            </button>
          )}
          <EntryList
            group={selectedGroup}
            entries={entries}
            selectedEntryId={selectedEntryId}
            onSelect={(entryId) => void loadDetail(entryId)}
          />
        </div>
        {detail === null ? (
          <section className="detail-pane detail-empty">
            {props.readOnly === true
              ? "Select an entry to inspect it."
              : "Select an entry to inspect or edit it."}
          </section>
        ) : (
          <MobileEntryDetail
            key={detail.id}
            api={props.api}
            detail={detail}
            groups={props.snapshot.groups}
            disabled={props.disabled}
            readOnly={props.readOnly === true}
            onDraftChange={setDetailDraft}
            onBusyChange={setDetailBusy}
            onSnapshot={acceptSnapshot}
            onDeleted={(next) => {
              acceptSnapshot(next, null);
            }}
            onMoved={(next, destination) => {
              setSelectedGroupId(destination);
              acceptSnapshot(next, detail.id);
            }}
          />
        )}
        {creating && !props.disabled && props.readOnly !== true ? (
          <EntryCreateDialog
            api={props.api}
            groupId={selectedGroup.id}
            onBusyChange={setCreateBusy}
            onCancel={() => {
              setCreating(false);
            }}
            onCreated={(result) => {
              setCreating(false);
              acceptSnapshot(result.snapshot, result.createdEntryId);
            }}
          />
        ) : null}
      </div>
    </>
  );
}
