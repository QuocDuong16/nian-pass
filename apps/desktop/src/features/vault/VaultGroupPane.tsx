import type { DesktopApi } from "../../lib/desktop";
import type { GroupDto, VaultSnapshotDto } from "../../types/desktop";
import { GroupActions } from "./GroupActions";
import { GroupTree } from "./GroupTree";

interface VaultGroupPaneProps {
  api: DesktopApi;
  snapshot: VaultSnapshotDto;
  groupsById: ReadonlyMap<string, GroupDto>;
  group: GroupDto;
  disabled: boolean;
  onSelect: (groupId: string) => void;
  onChanged: (snapshot: VaultSnapshotDto, groupId: string) => void;
  onDraftChange: (hasDraft: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}

export function VaultGroupPane(props: VaultGroupPaneProps) {
  return (
    <div className="group-pane">
      <div className="pane-heading">Groups</div>
      <GroupTree
        rootGroupId={props.snapshot.rootGroupId}
        recycleBinGroupId={props.snapshot.recycleBinGroupId}
        groupsById={props.groupsById}
        selectedGroupId={props.group.id}
        onSelect={props.onSelect}
      />
      <GroupActions
        api={props.api}
        group={props.group}
        snapshot={props.snapshot}
        disabled={props.disabled}
        onChanged={props.onChanged}
        onDraftChange={props.onDraftChange}
        onBusyChange={props.onBusyChange}
      />
    </div>
  );
}
