import type { EntrySummaryDto, SummaryTextDto } from "../../types/desktop";

export type EntrySortMode =
  | "database"
  | "title_asc"
  | "title_desc"
  | "username_asc"
  | "url_asc"
  | "expiry_asc";

interface SummarySortKey {
  rank: number;
  value: string;
}

function summarySortKey(summary: SummaryTextDto): SummarySortKey {
  if (summary.kind === "visible") {
    if (summary.value.length === 0) return { rank: 1, value: "" };
    return {
      rank: 0,
      value: summary.value.normalize("NFKD").toLowerCase(),
    };
  }
  if (summary.kind === "protected") return { rank: 2, value: "" };
  return { rank: 3, value: "" };
}

function compareSummary(
  left: SummaryTextDto,
  right: SummaryTextDto,
  descending: boolean,
): number {
  const leftKey = summarySortKey(left);
  const rightKey = summarySortKey(right);
  if (leftKey.rank !== rightKey.rank) return leftKey.rank - rightKey.rank;
  if (leftKey.rank !== 0 || leftKey.value === rightKey.value) return 0;
  const ordered = leftKey.value < rightKey.value ? -1 : 1;
  return descending ? -ordered : ordered;
}

export function sortEntriesForPresentation(
  entries: EntrySummaryDto[],
  mode: EntrySortMode,
): EntrySummaryDto[] {
  if (mode === "database") return [...entries];

  if (mode === "expiry_asc") {
    return entries
      .map((entry, index) => ({ entry, index }))
      .sort((left, right) => {
        const leftExpiry = left.entry.expiresAtUnixSeconds;
        const rightExpiry = right.entry.expiresAtUnixSeconds;
        if (leftExpiry === null && rightExpiry === null)
          return left.index - right.index;
        if (leftExpiry === null) return 1;
        if (rightExpiry === null) return -1;
        if (leftExpiry === rightExpiry) return left.index - right.index;
        return leftExpiry - rightExpiry;
      })
      .map(({ entry }) => entry);
  }

  const field =
    mode === "username_asc" ? "username" : mode === "url_asc" ? "url" : "title";
  const descending = mode === "title_desc";

  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const compared = compareSummary(
        left.entry[field],
        right.entry[field],
        descending,
      );
      return compared === 0 ? left.index - right.index : compared;
    })
    .map(({ entry }) => entry);
}
