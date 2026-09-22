import { useState } from "react";

import { Button } from "../../components/Button";
import type { EntryId, VaultCoreSnapshotDto } from "../../types/desktop";
import { EntryTags } from "./EntryTags";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";

const MAX_TAGS = 64;
const MAX_TAG_BYTES = 256;
const encoder = new TextEncoder();

interface EntryTagsApi<TSnapshot extends VaultCoreSnapshotDto> {
  setEntryTags: (entryId: EntryId, tags: string[]) => Promise<TSnapshot>;
}

interface Props<TSnapshot extends VaultCoreSnapshotDto> {
  api: EntryTagsApi<TSnapshot>;
  entryId: EntryId;
  tags: string[];
  disabled: boolean;
  readOnly?: boolean;
  onSnapshot: (snapshot: TSnapshot) => void;
  onDraftChange: (active: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}

export function EntryTagsSection<TSnapshot extends VaultCoreSnapshotDto>({
  api,
  entryId,
  tags,
  disabled,
  readOnly = false,
  onSnapshot,
  onDraftChange,
  onBusyChange,
}: Props<TSnapshot>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [candidate, setCandidate] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useSecurityFormTelemetry(editing, busy, onDraftChange, onBusyChange);

  const begin = () => {
    setDraft([...tags]);
    setCandidate("");
    setFailed(false);
    setEditing(true);
  };
  const candidateIssue = tagCandidateIssue(candidate, draft);
  const changed = !sameTags(draft, tags);

  const add = () => {
    if (candidate === "" || candidateIssue !== null) return;
    setDraft((current) => [...current, candidate]);
    setCandidate("");
    setFailed(false);
  };

  const apply = async () => {
    if (busy || !changed) return;
    setBusy(true);
    setFailed(false);
    try {
      onSnapshot(await api.setEntryTags(entryId, draft));
      setEditing(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <section className="detail-field" aria-labelledby="tags-label">
        <div className="history-heading">
          <h3 id="tags-label">Tags</h3>
          {readOnly ? null : (
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={disabled}
              onClick={begin}
            >
              Edit tags
            </Button>
          )}
        </div>
        {tags.length === 0 ? (
          <p className="secret-placeholder">No tags</p>
        ) : (
          <EntryTags tags={tags} />
        )}
      </section>
    );
  }

  return (
    <section className="detail-field" aria-labelledby="tags-label">
      <h3 id="tags-label">Tags</h3>
      {draft.length === 0 ? (
        <p className="secret-placeholder">No tags</p>
      ) : null}
      <div className="tag-list">
        {draft.map((tag, index) => (
          <span className="tag-chip" key={`${tag}-${String(index)}`}>
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              disabled={busy}
              onClick={() => {
                setDraft((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                );
                setFailed(false);
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="detail-value-row">
        <input
          aria-label="New tag"
          value={candidate}
          disabled={busy || draft.length >= MAX_TAGS}
          onChange={(event) => {
            setCandidate(event.currentTarget.value);
            setFailed(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={busy || candidate === "" || candidateIssue !== null}
          onClick={add}
        >
          Add
        </Button>
      </div>
      {candidateIssue === null ? null : (
        <p className="detail-error">{candidateIssue}</p>
      )}
      {failed ? <p role="alert">Could not update tags.</p> : null}
      <div className="detail-actions">
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={busy}
          onClick={() => {
            setEditing(false);
          }}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="button"
          disabled={busy || !changed}
          onClick={() => void apply()}
        >
          {busy ? "Applying…" : "Apply tags"}
        </Button>
      </div>
    </section>
  );
}

function tagCandidateIssue(candidate: string, tags: string[]): string | null {
  if (candidate === "") return null;
  if (tags.length >= MAX_TAGS)
    return `An entry can contain at most ${String(MAX_TAGS)} tags.`;
  if (encoder.encode(candidate).byteLength > MAX_TAG_BYTES) {
    return `A tag can contain at most ${String(MAX_TAG_BYTES)} UTF-8 bytes.`;
  }
  if (tags.includes(candidate)) return "That exact tag already exists.";
  return null;
}

function sameTags(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
