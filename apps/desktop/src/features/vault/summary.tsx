import type { SummaryTextDto } from "../../types/desktop";

interface SummaryProps {
  value: SummaryTextDto;
  missingLabel: string;
  emptyLabel: string;
}

export function Summary({ value, missingLabel, emptyLabel }: SummaryProps) {
  switch (value.kind) {
    case "missing":
      return <span className="summary-muted">{missingLabel}</span>;
    case "protected":
      return (
        <span className="summary-protected" aria-label="Protected">
          ••••••
        </span>
      );
    case "visible":
      return value.value === "" ? (
        <span className="summary-muted">{emptyLabel}</span>
      ) : (
        <span>{value.value}</span>
      );
  }
}
