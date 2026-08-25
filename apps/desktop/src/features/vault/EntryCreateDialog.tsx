import { useEffect, useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type { CreatedEntryDto, GroupId } from "../../types/desktop";

interface EntryCreateDialogProps {
  api: DesktopApi;
  groupId: GroupId;
  onCreated: (result: CreatedEntryDto) => void;
  onCancel: () => void;
}

export function EntryCreateDialog({
  api,
  groupId,
  onCreated,
  onCancel,
}: EntryCreateDialogProps) {
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
      >
        <h2 id="create-entry-title">New entry</h2>
        <label htmlFor="create-entry-name">Title</label>
        <input
          id="create-entry-name"
          value={title}
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
          <button
            type="button"
            onClick={() => {
              setPassword("");
            }}
          >
            Add password
          </button>
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
        {notes === null ? (
          <button
            type="button"
            onClick={() => {
              setNotes("");
            }}
          >
            Add notes
          </button>
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
          <button type="button" disabled={busy} onClick={cancel}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create entry"}
          </button>
        </div>
      </form>
    </div>
  );
}
