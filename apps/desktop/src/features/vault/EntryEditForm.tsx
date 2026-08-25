import { useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type {
  EntryDetailDto,
  SummaryTextDto,
  UpdateEntryRequest,
  VaultSnapshotDto,
} from "../../types/desktop";
import { EditableMetadataField } from "./EditableMetadataField";
import { useSecretDraft } from "./useSecretDraft";

interface EntryEditFormProps {
  api: DesktopApi;
  detail: EntryDetailDto;
  disabled: boolean;
  onApplied: (snapshot: VaultSnapshotDto) => void;
  onCancel: () => void;
}

export function EntryEditForm({
  api,
  detail,
  disabled,
  onApplied,
  onCancel,
}: EntryEditFormProps) {
  const title = useSecretDraft();
  const username = useSecretDraft();
  const url = useSecretDraft();
  const notes = useSecretDraft();
  const [passwordDraft, setPasswordDraft] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [failed, setFailed] = useState(false);

  const clearSecrets = () => {
    setPasswordDraft(null);
    notes.clear();
    if (detail.title.kind === "protected") title.clear();
    if (detail.username.kind === "protected") username.clear();
    if (detail.url.kind === "protected") url.clear();
  };

  const cancel = () => {
    clearSecrets();
    onCancel();
  };

  const apply = async () => {
    if (disabled || applying) return;
    setApplying(true);
    setFailed(false);
    const request: UpdateEntryRequest = { entryId: detail.id };
    const addMetadata = (
      key: "title" | "username" | "url",
      value: string | null,
      summary: SummaryTextDto,
    ) => {
      if (summary.kind === "protected" && value === null) return;
      request[key] = value ?? (summary.kind === "visible" ? summary.value : "");
    };
    addMetadata("title", title.value, detail.title);
    addMetadata("username", username.value, detail.username);
    addMetadata("url", url.value, detail.url);
    if (passwordDraft !== null) request.password = passwordDraft;
    if (notes.value !== null) request.notes = notes.value;
    try {
      const snapshot = await api.updateEntry(request);
      clearSecrets();
      onApplied(snapshot);
    } catch {
      clearSecrets();
      setFailed(true);
    } finally {
      setApplying(false);
    }
  };

  return (
    <form
      className="mutation-form"
      onSubmit={(event) => {
        event.preventDefault();
        void apply();
      }}
    >
      <h2>Edit entry</h2>
      <EditableMetadataField
        label="Title"
        summary={detail.title}
        draft={title}
        disabled={disabled || applying}
        load={() => api.revealEntryTitle(detail.id)}
      />
      <EditableMetadataField
        label="Username"
        summary={detail.username}
        draft={username}
        disabled={disabled || applying}
        load={() => api.revealEntryUsername(detail.id)}
      />
      <EditableMetadataField
        label="URL"
        summary={detail.url}
        draft={url}
        disabled={disabled || applying}
        load={() => api.revealEntryUrl(detail.id)}
      />

      <div className="form-field">
        <label htmlFor="new-password">Password</label>
        {passwordDraft === null ? (
          <button
            type="button"
            onClick={() => {
              setPasswordDraft("");
            }}
          >
            Set new password
          </button>
        ) : (
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={passwordDraft}
            disabled={disabled || applying}
            onChange={(event) => {
              setPasswordDraft(event.currentTarget.value);
            }}
          />
        )}
        <small>
          Existing password is never preloaded. Empty sets an empty password.
        </small>
      </div>

      <div className="form-field">
        <label htmlFor="edit-notes">Notes</label>
        {notes.value === null ? (
          <button
            type="button"
            disabled={disabled || notes.loading}
            onClick={() => {
              if (detail.notesPresent)
                void notes.load(() => api.revealEntryNotes(detail.id));
              else notes.set("");
            }}
          >
            {notes.loading
              ? "Loading notes…"
              : detail.notesPresent
                ? "Load notes for editing"
                : "Add notes"}
          </button>
        ) : (
          <textarea
            id="edit-notes"
            value={notes.value}
            disabled={disabled || applying}
            onChange={(event) => {
              notes.set(event.currentTarget.value);
            }}
          />
        )}
      </div>
      {failed ? <p role="alert">Could not update this entry.</p> : null}
      <div className="dialog-actions">
        <button type="button" disabled={applying} onClick={cancel}>
          Cancel
        </button>
        <button type="submit" disabled={disabled || applying}>
          {applying ? "Applying…" : "Apply changes"}
        </button>
      </div>
    </form>
  );
}
