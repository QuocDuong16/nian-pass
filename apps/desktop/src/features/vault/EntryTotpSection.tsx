import { useEffect, useState } from "react";

import { Button } from "../../components/Button";
import type { DesktopApi } from "../../lib/desktop";
import type { EntryDetailDto, VaultSnapshotDto } from "../../types/desktop";
import {
  EntryTotpEditorDialog,
  type TotpEditorMode,
} from "./EntryTotpEditorDialog";
import { validTotpUri } from "./totp-validation";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";
import { useTotpCode } from "./useTotpCode";

interface Props {
  api: DesktopApi;
  detail: EntryDetailDto;
  disabled: boolean;
  mutationDisabled: boolean;
  recycled: boolean;
  clearRevealsVersion: number;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onDraftChange?: (active: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}

type ContentProps = Omit<Props, "clearRevealsVersion">;

export function EntryTotpSection(props: Props) {
  const { clearRevealsVersion, ...contentProps } = props;
  return (
    <EntryTotpSectionContent key={clearRevealsVersion} {...contentProps} />
  );
}

function EntryTotpSectionContent({
  api,
  detail,
  disabled,
  mutationDisabled,
  recycled,
  onSnapshot,
  onDraftChange,
  onBusyChange,
}: ContentProps) {
  const totp = useTotpCode();
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [editor, setEditor] = useState<TotpEditorMode | null>(null);
  const [uri, setUri] = useState("");
  const [applying, setApplying] = useState(false);
  const [mutationFailed, setMutationFailed] = useState(false);

  useSecurityFormTelemetry(
    editor !== null,
    loading || copying || applying,
    onDraftChange,
    onBusyChange,
  );

  useEffect(() => {
    if (copyStatus === null) return;
    const timer = window.setTimeout(() => {
      setCopyStatus(null);
    }, 4_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copyStatus]);

  const reveal = async () => {
    if (disabled || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      totp.show(await api.revealEntryTotp(detail.id));
    } catch {
      setFailed(true);
      totp.clear();
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (disabled || copying) return;
    setCopying(true);
    setCopyStatus(null);
    try {
      const receipt = await api.copyEntryTotp(detail.id);
      setCopyStatus(
        `TOTP copied. Clipboard clears in ${String(receipt.expiresInMs / 1000)}s if unchanged.`,
      );
    } catch {
      setCopyStatus("Could not copy the TOTP code.");
    } finally {
      setCopying(false);
    }
  };

  const openEditor = (mode: TotpEditorMode) => {
    setUri("");
    setMutationFailed(false);
    setEditor(mode);
  };

  const apply = async () => {
    if (editor === null || applying || disabled || mutationDisabled || recycled)
      return;
    if (editor === "replace" && !validTotpUri(uri)) return;
    setApplying(true);
    setMutationFailed(false);
    try {
      const snapshot = await api.updateEntry(
        editor === "clear"
          ? { entryId: detail.id, totpEnabled: false }
          : { entryId: detail.id, totpEnabled: true, totpUri: uri.trim() },
      );
      totp.clear();
      setEditor(null);
      setUri("");
      onSnapshot(snapshot);
    } catch {
      setMutationFailed(true);
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="detail-field" aria-labelledby="totp-label">
      <h3 id="totp-label">One-time password (TOTP)</h3>
      {detail.totpPresent ? (
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
            <Button
              size="sm"
              variant="secondary"
              type="button"
              disabled={disabled || loading}
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
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={disabled || copying}
              onClick={() => {
                void copy();
              }}
            >
              {copying ? "Copying…" : "Copy code"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={disabled || mutationDisabled || recycled}
              onClick={() => {
                openEditor("replace");
              }}
            >
              Replace
            </Button>
            <Button
              size="sm"
              variant="danger"
              type="button"
              disabled={disabled || mutationDisabled || recycled}
              onClick={() => {
                openEditor("clear");
              }}
            >
              Remove
            </Button>
          </div>
          {failed ? (
            <p role="alert">Could not generate this TOTP code.</p>
          ) : null}
        </div>
      ) : (
        <div className="secret-block">
          <span className="secret-placeholder">No TOTP configured</span>
          <Button
            size="sm"
            variant="secondary"
            type="button"
            disabled={disabled || mutationDisabled || recycled}
            onClick={() => {
              openEditor("replace");
            }}
          >
            Configure TOTP
          </Button>
        </div>
      )}
      <p className="copy-status" aria-live="polite">
        {copyStatus ?? ""}
      </p>
      {editor === null ? null : (
        <EntryTotpEditorDialog
          mode={editor}
          uri={uri}
          applying={applying}
          failed={mutationFailed}
          onUri={setUri}
          onCancel={() => {
            setEditor(null);
            setUri("");
          }}
          onApply={() => {
            void apply();
          }}
        />
      )}
    </section>
  );
}
