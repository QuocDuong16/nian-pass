import { useMemo } from "react";

import type { GroupDto, VaultSnapshotDto } from "../../types/desktop";
import { searchVault } from "./vault-search";

export function useVaultSearch(
  snapshot: VaultSnapshotDto,
  groupsById: Map<string, GroupDto>,
  query: string,
) {
  return useMemo(
    () => searchVault(snapshot, groupsById, query),
    [snapshot, groupsById, query],
  );
}
