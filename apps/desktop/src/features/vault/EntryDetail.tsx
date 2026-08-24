import { useEffect, useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type { EntryDetailDto, EntryId } from "../../types/desktop";
import { Summary } from "./summary";
import { useSecretReveal } from "./useSecretReveal";

interface EntryDetailProps {
  api: DesktopApi;
  entryId: EntryId;
  disabled: boolean;
}

type CopyTarget = "username" | "password";

export function EntryDetail(props: EntryDetailProps) {
  return (
    <EntryDetailContent
      key={`${props.entryId}:${String(props.disabled)}`}
      {...props}
    />
  );
}

function EntryDetailContent({ api, entryId, disabled }: EntryDetailProps) {
  const [detail, setDetail] = useState<EntryDetailDto | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [copying, setCopying] = useState<CopyTarget | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const password = useSecretReveal({
    entryId,
    disabled,
    load: api.revealEntryPassword,
  });
  const notes = useSecretReveal({
    entryId,
    disabled,
    load: api.revealEntryNotes,
  });

  useEffect(() => {
    let active = true;
    void api
      .getEntryDetail(entryId)
      .then((value) => {
        if (active && value.id === entryId) setDetail(value);
      })
      .catch(() => {
        if (active) setDetailFailed(true);
      });
    return () => {
      active = false;
    };
  }, [api, entryId]);

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
          ? await api.copyEntryPassword(entryId)
          : await api.copyEntryUsername(entryId);
      setCopyStatus(
        `Copied. Clipboard clears in ${String(receipt.expiresInMs / 1000)}s if unchanged.`,
      );
    } catch {
      setCopyStatus("Could not copy to the clipboard.");
    } finally {
      setCopying(null);
    }
  };

  if (detailFailed) {
    return (
      <aside className="detail-pane" aria-label="Entry detail">
        <p className="detail-error" role="alert">
          Could not load this entry.
        </p>
      </aside>
    );
  }
  if (detail === null) {
    return (
      <aside className="detail-pane" aria-label="Entry detail">
        <p className="detail-loading">Loading entry…</p>
      </aside>
    );
  }

  return (
    <aside className="detail-pane" aria-labelledby="entry-detail-title">
      <p className="eyebrow">Entry detail</p>
      <h2 id="entry-detail-title">
        <Summary
          value={detail.title}
          missingLabel="Untitled entry"
          emptyLabel="Empty title"
        />
      </h2>

      <section className="detail-field" aria-labelledby="username-label">
        <h3 id="username-label">Username</h3>
        <div className="detail-value-row">
          <span className="detail-value">
            <Summary
              value={detail.username}
              missingLabel="No username"
              emptyLabel="Empty username"
            />
          </span>
          <button
            className="compact-button"
            type="button"
            disabled={
              disabled || detail.username.kind === "missing" || copying !== null
            }
            onClick={() => void copy("username")}
          >
            {copying === "username" ? "Copying…" : "Copy username"}
          </button>
        </div>
      </section>

      <section className="detail-field" aria-labelledby="url-label">
        <h3 id="url-label">URL</h3>
        <div className="detail-value">
          <Summary
            value={detail.url}
            missingLabel="No URL"
            emptyLabel="Empty URL"
          />
        </div>
      </section>

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
            <button
              className="compact-button"
              type="button"
              disabled={disabled || !detail.passwordPresent || password.loading}
              onClick={() => {
                if (password.secret === null) {
                  void password.reveal();
                } else {
                  password.clear();
                }
              }}
            >
              {password.loading
                ? "Revealing…"
                : password.secret === null
                  ? "Reveal password"
                  : "Hide password"}
            </button>
            <button
              className="compact-button"
              type="button"
              disabled={disabled || !detail.passwordPresent || copying !== null}
              onClick={() => void copy("password")}
            >
              {copying === "password" ? "Copying…" : "Copy password"}
            </button>
          </div>
          {password.failed ? (
            <p className="detail-error" role="alert">
              Could not reveal the password.
            </p>
          ) : null}
        </div>
      </section>

      <section className="detail-field" aria-labelledby="notes-label">
        <h3 id="notes-label">Notes</h3>
        {notes.secret === null ? (
          <p className="notes-presence">
            {detail.notesPresent ? "Notes present" : "No notes"}
          </p>
        ) : (
          <pre className="notes-value">{notes.secret}</pre>
        )}
        <button
          className="compact-button"
          type="button"
          disabled={disabled || !detail.notesPresent || notes.loading}
          onClick={() => {
            if (notes.secret === null) {
              void notes.reveal();
            } else {
              notes.clear();
            }
          }}
        >
          {notes.loading
            ? "Revealing…"
            : notes.secret === null
              ? "Reveal notes"
              : "Hide notes"}
        </button>
        {notes.failed ? (
          <p className="detail-error" role="alert">
            Could not reveal notes.
          </p>
        ) : null}
      </section>

      {detail.customFields.length > 0 ? (
        <section className="detail-field" aria-labelledby="custom-fields-label">
          <h3 id="custom-fields-label">Custom fields</h3>
          <ul className="custom-field-list">
            {detail.customFields.map((field) => (
              <li key={`${field.name}:${field.protection}`}>
                <span>{field.name}</span>
                <span>
                  {field.protection === "protected"
                    ? "Protected"
                    : "Unprotected"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="copy-status" aria-live="polite">
        {copyStatus ?? ""}
      </p>
    </aside>
  );
}
