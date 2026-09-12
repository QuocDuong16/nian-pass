import { useMemo } from "react";

import type {
  GroupDto,
  SummaryTextDto,
  VaultSnapshotDto,
} from "../../types/desktop";

function visibleText(value: SummaryTextDto): string {
  return value.kind === "visible" ? value.value : "";
}

export function useVaultSearch(
  snapshot: VaultSnapshotDto,
  groupsById: Map<string, GroupDto>,
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return useMemo(() => {
    if (normalizedQuery === "") return null;
    return snapshot.entries.filter((entry) => {
      const groupName = groupsById.get(entry.groupId)?.name ?? "";
      const searchable = [
        visibleText(entry.title),
        visibleText(entry.username),
        visibleText(entry.url),
        ...entry.tags,
        groupName,
      ];
      return searchable.some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      );
    });
  }, [groupsById, normalizedQuery, snapshot.entries]);
}
