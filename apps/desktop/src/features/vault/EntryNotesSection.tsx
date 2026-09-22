import { useEffect } from "react";

import { Button } from "../../components/Button";
import type { DesktopApi } from "../../lib/desktop";
import type { EntryDetailDto } from "../../types/desktop";
import { useSecretReveal } from "./useSecretReveal";

interface Props {
  api: DesktopApi;
  detail: EntryDetailDto;
  disabled: boolean;
  clearRevealsVersion: number;
  copying: boolean;
  copyDisabled: boolean;
  onCopy: () => void;
}

export function EntryNotesSection({
  api,
  detail,
  disabled,
  clearRevealsVersion,
  copying,
  copyDisabled,
  onCopy,
}: Props) {
  const notes = useSecretReveal({
    entryId: detail.id,
    disabled,
    load: api.revealEntryNotes,
  });
  const clear = notes.clear;

  useEffect(() => {
    clear();
  }, [clear, clearRevealsVersion]);

  return (
    <section className="detail-field" aria-labelledby="notes-label">
      <h3 id="notes-label">Notes</h3>
      {notes.secret === null ? (
        <p>{detail.notesPresent ? "Notes present" : "No notes"}</p>
      ) : (
        <pre className="notes-value">{notes.secret}</pre>
      )}
      <div className="detail-actions">
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={disabled || !detail.notesPresent || notes.loading}
          onClick={() => {
            if (notes.secret === null) void notes.reveal();
            else notes.clear();
          }}
        >
          {notes.loading
            ? "Revealing…"
            : notes.secret === null
              ? "Reveal notes"
              : "Hide notes"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          aria-label="Copy notes"
          disabled={disabled || !detail.notesPresent || copyDisabled}
          onClick={onCopy}
        >
          {copying ? "Copying…" : "Copy"}
        </Button>
      </div>
      {notes.failed ? <p role="alert">Could not reveal notes.</p> : null}
    </section>
  );
}
