import { useState } from "react";

import type { VaultSnapshotDto } from "../../types/desktop";

interface UseVaultBulkActionsOptions {
  onClearEntry: () => void;
  onSelectGroup: (groupId: string) => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
}

export function useVaultBulkActions(options: UseVaultBulkActionsOptions) {
  const [busy, setBusy] = useState(false);

  const onChanged = (
    snapshot: VaultSnapshotDto,
    destinationGroupId?: string,
  ) => {
    options.onClearEntry();
    if (destinationGroupId !== undefined) {
      options.onSelectGroup(destinationGroupId);
    }
    options.onSnapshot(snapshot);
  };

  return {
    busy,
    onBusyChange: setBusy,
    onSelectionStart: options.onClearEntry,
    onChanged,
  };
}
