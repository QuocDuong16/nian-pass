import { useEffect, useState } from "react";

import type { EntryDetailDto } from "../../types/desktop";
import type { MobileApi, MobileVaultSnapshotDto } from "../../types/mobile";
import {
  EntryTotpEditorDialog,
  type TotpEditorMode,
} from "../vault/EntryTotpEditorDialog";
import { validTotpUri } from "../vault/totp-validation";
import { useTotpCode } from "../vault/useTotpCode";

interface Props {
  api: MobileApi;
  detail: EntryDetailDto;
  disabled: boolean;
  readOnly: boolean;
  onSnapshot: (snapshot: MobileVaultSnapshotDto) => void;
  onDraftChange: (active: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}

export function MobileTotpSection(props: Props) {
  const { onBusyChange, onDraftChange } = props;
  const totp = useTotpCode();
  const [editor, setEditor] = useState<TotpEditorMode | null>(null);
  const [uri, setUri] = useState("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [mutationFailed, setMutationFailed] = useState(false);

  useEffect(() => {
    onDraftChange(editor !== null);
    return () => {
      onDraftChange(false);
    };
  }, [editor, onDraftChange]);

  useEffect(() => {
    onBusyChange(loading || applying);
    return () => {
      onBusyChange(false);
    };
  }, [applying, loading, onBusyChange]);

  const setEditorState = (mode: TotpEditorMode | null) => {
    setUri("");
    setMutationFailed(false);
    setEditor(mode);
  };

  const reveal = async () => {
    if (props.disabled || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      totp.show(await props.api.revealEntryTotp(props.detail.id));
    } catch {
      totp.clear();
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (
      editor === null ||
      applying ||
      props.disabled ||
      props.readOnly ||
      (editor === "replace" && !validTotpUri(uri))
    )
      return;
    setApplying(true);
    setMutationFailed(false);
    try {
      const snapshot = await props.api.updateEntry(
        editor === "clear"
          ? { entryId: props.detail.id, totpEnabled: false }
          : {
              entryId: props.detail.id,
              totpEnabled: true,
              totpUri: uri.trim(),
            },
      );
      totp.clear();
      setEditorState(null);
      props.onSnapshot(snapshot);
    } catch {
      setMutationFailed(true);
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="detail-field" aria-labelledby="mobile-totp-label">
      <h3 id="mobile-totp-label">One-time password (TOTP)</h3>
      {props.detail.totpPresent ? (
        <div className="secret-block">
          {totp.code === null ? (
            <span className="secret-placeholder">TOTP configured</span>
          ) : (
            <>
              <pre className="secret-value">{totp.code.code}</pre>
              <small>
                Valid for {String(totp.remaining)}s ·{" "}
                {String(totp.code.periodSeconds)}s period
              </small>
            </>
          )}
          <div className="detail-actions">
            <button
              type="button"
              disabled={props.disabled || loading}
              onClick={() => {
                if (totp.code === null) void reveal();
                else totp.clear();
              }}
            >
              {loading
                ? "Generating…"
                : totp.code === null
                  ? "Show code"
                  : "Hide code"}
            </button>
            {props.readOnly ? null : (
              <>
                <button
                  type="button"
                  disabled={props.disabled}
                  onClick={() => {
                    setEditorState("replace");
                  }}
                >
                  Replace
                </button>
                <button
                  type="button"
                  disabled={props.disabled}
                  onClick={() => {
                    setEditorState("clear");
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </div>
          {failed ? (
            <p role="alert">Could not generate this TOTP code.</p>
          ) : null}
        </div>
      ) : (
        <div className="secret-block">
          <span className="secret-placeholder">No TOTP configured</span>
          {props.readOnly ? null : (
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => {
                setEditorState("replace");
              }}
            >
              Configure TOTP
            </button>
          )}
        </div>
      )}
      {editor === null ? null : (
        <EntryTotpEditorDialog
          mode={editor}
          uri={uri}
          applying={applying}
          failed={mutationFailed}
          onUri={setUri}
          onCancel={() => {
            setEditorState(null);
          }}
          onApply={() => {
            void apply();
          }}
        />
      )}
    </section>
  );
}
