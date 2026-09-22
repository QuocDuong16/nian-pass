import type { DesktopApi } from "../../lib/desktop";
import type { CreatedEntryDto, VaultSnapshotDto } from "../../types/desktop";
import { EntryCreateDialog } from "./EntryCreateDialog";
import { VaultSettingsDialog } from "./VaultSettingsDialog";

interface VaultOverlaysProps {
  api: DesktopApi;
  snapshot: VaultSnapshotDto;
  settingsOpen: boolean;
  disabled: boolean;
  hasDraft: boolean;
  mutationPending: boolean;
  autoLockMs: number | null;
  creatingEntry: boolean;
  createAllowed: boolean;
  selectedGroupId: string;
  onAutoLockChange: ((timeoutMs: number | null) => void) | undefined;
  onSyncBusy: (busy: boolean) => void;
  onCreateBusy: (busy: boolean) => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onCloseSettings: () => void;
  onCancelCreate: () => void;
  onCreated: (result: CreatedEntryDto) => void;
}

export function VaultOverlays(props: VaultOverlaysProps) {
  return (
    <>
      {props.settingsOpen ? (
        <VaultSettingsDialog
          api={props.api}
          snapshot={props.snapshot}
          disabled={props.disabled}
          hasDraft={props.hasDraft}
          mutationPending={props.mutationPending}
          autoLockMs={props.autoLockMs}
          onAutoLockChange={props.onAutoLockChange}
          onBusyChange={props.onSyncBusy}
          onSnapshot={props.onSnapshot}
          onClose={props.onCloseSettings}
        />
      ) : null}
      {props.creatingEntry && props.createAllowed ? (
        <EntryCreateDialog
          api={props.api}
          groupId={props.selectedGroupId}
          onCancel={props.onCancelCreate}
          onCreated={props.onCreated}
          onBusyChange={props.onCreateBusy}
        />
      ) : null}
    </>
  );
}
