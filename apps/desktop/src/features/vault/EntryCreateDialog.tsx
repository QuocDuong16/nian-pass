import { useEffect, useState } from "react";

import { Button } from "../../components/Button";
import type {
  CreatedEntryBaseDto,
  GroupId,
  VaultCoreSnapshotDto,
  VaultSnapshotDto,
} from "../../types/desktop";
import type { EntryCreateApi } from "../../types/mutation-api";
import { PasswordGenerator } from "./PasswordGenerator";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";

interface EntryCreateDialogProps<
  TSnapshot extends VaultCoreSnapshotDto = VaultSnapshotDto,
> {
  api: EntryCreateApi<TSnapshot>;
  groupId: GroupId;
  onCreated: (result: CreatedEntryBaseDto<TSnapshot>) => void;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export function EntryCreateDialog<
  TSnapshot extends VaultCoreSnapshotDto = VaultSnapshotDto,
>({
  api,
  groupId,
  onCreated,
  onCancel,
  onBusyChange,
}: EntryCreateDialogProps<TSnapshot>) {
  const [title, setTitle] = useState("");
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState("");
  const [password, setPassword] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const clearSecrets = () => {
    setPassword(null);
    setNotes(null);
  };

  useEffect(() => clearSecrets, []);

  useSecurityFormTelemetry(true, busy, undefined, onBusyChange);

  const cancel = () => {
    clearSecrets();
    onCancel();
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await api.createEntry({
        groupId,
        title,
        username,
        url,
        password,
        notes,
      });
      clearSecrets();
      onCreated(result);
    } catch {
      clearSecrets();
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <form
        className="modal-panel mutation-form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-entry-title"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) cancel();
        }}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Selected group</p>
            <h2 id="create-entry-title">New entry</h2>
          </div>
          <span className="dialog-hint">
            Create locally, then Save the vault.
          </span>
        </div>
        <label htmlFor="create-entry-name">Title</label>
        <input
          id="create-entry-name"
          value={title}
          autoFocus
          onChange={(event) => {
            setTitle(event.currentTarget.value);
          }}
        />
        <label htmlFor="create-entry-username">Username</label>
        <input
          id="create-entry-username"
          value={username}
          onChange={(event) => {
            setUsername(event.currentTarget.value);
          }}
        />
        <label htmlFor="create-entry-url">URL</label>
        <input
          id="create-entry-url"
          value={url}
          onChange={(event) => {
            setUrl(event.currentTarget.value);
          }}
        />
        {password === null ? (
          <Button
            size="sm"
            variant="secondary"
            type="button"
            onClick={() => {
              setPassword("");
            }}
          >
            Add password
          </Button>
        ) : (
          <>
            <label htmlFor="create-entry-password">Password</label>
            <input
              id="create-entry-password"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={password}
              onChange={(event) => {
                setPassword(event.currentTarget.value);
              }}
            />
          </>
        )}
        <PasswordGenerator
          disabled={busy}
          onGenerated={(generated) => {
            setPassword(generated);
          }}
        />
        {notes === null ? (
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => {
              setNotes("");
            }}
          >
            Add notes
          </Button>
        ) : (
          <>
            <label htmlFor="create-entry-notes">Notes</label>
            <textarea
              id="create-entry-notes"
              value={notes}
              onChange={(event) => {
                setNotes(event.currentTarget.value);
              }}
            />
          </>
        )}
        {failed ? <p role="alert">Could not create the entry.</p> : null}
        <div className="dialog-actions">
          <Button
            size="sm"
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={cancel}
          >
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create entry"}
          </Button>
        </div>
      </form>
    </div>
  );
}
