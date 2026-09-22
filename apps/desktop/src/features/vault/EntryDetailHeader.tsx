import { Button } from "../../components/Button";
import type { SummaryTextDto } from "../../types/desktop";
import { Summary } from "./summary";

interface EntryDetailHeaderProps {
  title: SummaryTextDto;
  editDisabled: boolean;
  copyDisabled: boolean;
  copying: boolean;
  onEdit: () => void;
  onCopy: () => void;
}

export function EntryDetailHeader({
  title,
  editDisabled,
  copyDisabled,
  copying,
  onEdit,
  onCopy,
}: EntryDetailHeaderProps) {
  return (
    <div className="section-heading-row">
      <div>
        <p className="eyebrow">Entry detail</p>
        <h2 id="entry-detail-title">
          <Summary
            value={title}
            missingLabel="Untitled entry"
            emptyLabel="Empty title"
          />
        </h2>
      </div>
      <div className="detail-inline-actions">
        <Button
          size="sm"
          variant="ghost"
          type="button"
          aria-label="Copy title"
          disabled={copyDisabled || title.kind === "missing"}
          onClick={onCopy}
        >
          {copying ? "Copying…" : "Copy"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          aria-label="Edit entry"
          disabled={editDisabled}
          onClick={onEdit}
        >
          Edit
        </Button>
      </div>
    </div>
  );
}
