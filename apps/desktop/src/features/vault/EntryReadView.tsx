import { useEffect, useState } from "react";

import { Button } from "../../components/Button";
import type { DesktopApi } from "../../lib/desktop";
import type {
  EntryDetailDto,
  GroupDto,
  GroupId,
  VaultSnapshotDto,
} from "../../types/desktop";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { EntryActions } from "./EntryActions";
import { EntryIdentityFields } from "./EntryIdentityFields";
import { Summary } from "./summary";
import { useSecretReveal } from "./useSecretReveal";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";

interface EntryReadViewProps {
  api: DesktopApi;
  detail: EntryDetailDto;
  groups: GroupDto[];
  disabled: boolean;
  mutationDisabled?: boolean;
  onEdit: () => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onDeleted: (snapshot: VaultSnapshotDto) => void;
  onMoved: (snapshot: VaultSnapshotDto, destination: GroupId) => void;
  onDraftChange?: (active: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  clearRevealsVersion?: number;
}

type CopyTarget = "username" | "password";

export function EntryReadView({
  api,
  detail,
  groups,
  disabled,
  mutationDisabled = false,
  onEdit,
  onSnapshot,
  onDeleted,
  onMoved,
  onDraftChange,
  onBusyChange,
  clearRevealsVersion = 0,
}: EntryReadViewProps) {
  const [copying, setCopying] = useState<CopyTarget | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [customFieldDraft, setCustomFieldDraft] = useState(false);
  const [entryActionDraft, setEntryActionDraft] = useState(false);
  const [customFieldBusy, setCustomFieldBusy] = useState(false);
  const [entryActionBusy, setEntryActionBusy] = useState(false);
  const password = useSecretReveal({
    entryId: detail.id,
    disabled,
    load: api.revealEntryPassword,
  });
  const notes = useSecretReveal({
    entryId: detail.id,
    disabled,
    load: api.revealEntryNotes,
  });
  const clearPassword = password.clear;
  const clearNotes = notes.clear;

  useSecurityFormTelemetry(
    customFieldDraft || entryActionDraft,
    customFieldBusy || entryActionBusy || copying !== null,
    onDraftChange,
    onBusyChange,
  );

  useEffect(() => {
    clearPassword();
    clearNotes();
  }, [clearNotes, clearPassword, clearRevealsVersion]);

  useEffect(() => {
    if (copyStatus === null) return;
    const timer = setTimeout(() => {
      setCopyStatus(null);
    }, 4_000);
    return () => {
      clearTimeout(timer);
    };
  }, [copyStatus]);

  const copy = async (target: CopyTarget) => {
    if (disabled || copying !== null) return;
    setCopying(target);
    setCopyStatus(null);
    try {
      const receipt =
        target === "password"
          ? await api.copyEntryPassword(detail.id)
          : await api.copyEntryUsername(detail.id);
      setCopyStatus(
        `Copied. Clipboard clears in ${String(receipt.expiresInMs / 1000)}s if unchanged.`,
      );
    } catch {
      setCopyStatus("Could not copy to the clipboard.");
    } finally {
      setCopying(null);
    }
  };

  return (
    <>
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Entry detail</p>
          <h2 id="entry-detail-title">
            <Summary
              value={detail.title}
              missingLabel="Untitled entry"
              emptyLabel="Empty title"
            />
          </h2>
        </div>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          aria-label="Edit entry"
          disabled={disabled || mutationDisabled}
          onClick={onEdit}
        >
          Edit
        </Button>
      </div>
      <EntryIdentityFields
        detail={detail}
        disabled={disabled}
        copyDisabled={copying !== null}
        copyingUsername={copying === "username"}
        onCopyUsername={() => void copy("username")}
      />
      <section className="detail-field" aria-labelledby="password-label">
        <h3 id="password-label">Password</h3>
        <div className="secret-block">
          {password.secret === null ? (
            <span className="secret-placeholder">
              {detail.passwordPresent ? "••••••••" : "No password"}
            </span>
          ) : (
            <pre className="secret-value">{password.secret}</pre>
          )}
          <div className="detail-actions">
            <Button
              size="sm"
              variant="secondary"
              type="button"
              aria-label={
                password.loading
                  ? "Revealing…"
                  : password.secret === null
                    ? "Reveal password"
                    : "Hide password"
              }
              disabled={disabled || !detail.passwordPresent || password.loading}
              onClick={() => {
                if (password.secret === null) void password.reveal();
                else password.clear();
              }}
            >
              {password.loading
                ? "Revealing…"
                : password.secret === null
                  ? "Reveal"
                  : "Hide"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              aria-label="Copy password"
              disabled={disabled || !detail.passwordPresent || copying !== null}
              onClick={() => void copy("password")}
            >
              {copying === "password" ? "Copying…" : "Copy"}
            </Button>
          </div>
          {password.failed ? (
            <p role="alert">Could not reveal the password.</p>
          ) : null}
        </div>
      </section>
      <section className="detail-field" aria-labelledby="notes-label">
        <h3 id="notes-label">Notes</h3>
        {notes.secret === null ? (
          <p>{detail.notesPresent ? "Notes present" : "No notes"}</p>
        ) : (
          <pre className="notes-value">{notes.secret}</pre>
        )}
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
      </section>
      <CustomFieldsEditor
        api={api}
        entryId={detail.id}
        fields={detail.customFields}
        disabled={disabled || mutationDisabled}
        onApplied={onSnapshot}
        onDraftChange={setCustomFieldDraft}
        onBusyChange={setCustomFieldBusy}
      />
      <EntryActions
        api={api}
        detail={detail}
        groups={groups}
        disabled={disabled || mutationDisabled}
        onDeleted={onDeleted}
        onMoved={onMoved}
        onDraftChange={setEntryActionDraft}
        onBusyChange={setEntryActionBusy}
      />
      <p className="copy-status" aria-live="polite">
        {copyStatus ?? ""}
      </p>
    </>
  );
}
