import { useState } from "react";

import { Button } from "../../components/Button";
import type {
  EntryDetailDto,
  SummaryTextDto,
  UpdateEntryRequest,
  VaultCoreSnapshotDto,
  VaultSnapshotDto,
} from "../../types/desktop";
import type { EntryEditApi } from "../../types/mutation-api";
import { EditableMetadataField } from "./EditableMetadataField";
import { PasswordGenerator } from "./PasswordGenerator";
import { useSecretDraft } from "./useSecretDraft";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";

interface EntryEditFormProps<
  TSnapshot extends VaultCoreSnapshotDto = VaultSnapshotDto,
> {
  api: EntryEditApi<TSnapshot>;
  detail: EntryDetailDto;
  disabled: boolean;
  onApplied: (snapshot: TSnapshot) => void;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export function EntryEditForm<
  TSnapshot extends VaultCoreSnapshotDto = VaultSnapshotDto,
>({
  api,
  detail,
  disabled,
  onApplied,
  onCancel,
  onBusyChange,
}: EntryEditFormProps<TSnapshot>) {
  const title = useSecretDraft();
  const username = useSecretDraft();
  const url = useSecretDraft();
  const notes = useSecretDraft();
  const [passwordDraft, setPasswordDraft] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [failed, setFailed] = useState(false);

  useSecurityFormTelemetry(true, applying, undefined, onBusyChange);

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
      className="mutation-form detail-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        void apply();
      }}
    >
      <div className="detail-edit-header">
        <div>
          <p className="eyebrow">Entry</p>
          <h2>Edit entry</h2>
        </div>
        <div className="detail-edit-actions">
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={applying}
            onClick={cancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            type="submit"
            disabled={disabled || applying}
          >
            {applying ? "Applying…" : "Apply changes"}
          </Button>
        </div>
      </div>
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
        <PasswordGenerator
          disabled={disabled || applying}
          onGenerated={(generated) => {
            setPasswordDraft(generated);
          }}
        />
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
              : notes.failed
                ? "Retry loading notes"
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
        {notes.failed ? (
          <p role="alert">Could not load notes for editing.</p>
        ) : null}
      </div>
      {failed ? <p role="alert">Could not update this entry.</p> : null}
    </form>
  );
}
