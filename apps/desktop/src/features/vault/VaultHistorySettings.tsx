import { useEffect, useMemo, useState } from "react";

import { Button } from "../../components/Button";
import type { DesktopApi } from "../../lib/desktop";
import type { HistoryPolicyDto, VaultSnapshotDto } from "../../types/desktop";

interface Props {
  api: DesktopApi;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
}

function parseDraft(value: string, maximum: number): number | null | undefined {
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    return undefined;
  }
  return parsed;
}

export function VaultHistorySettings(props: Props) {
  const [canonical, setCanonical] = useState<HistoryPolicyDto | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void props.api
      .getHistoryPolicy()
      .then((policy) => {
        if (!active) return;
        setCanonical(policy);
        setDraft(policy.maxItems === null ? "" : String(policy.maxItems));
        setStatus(null);
      })
      .catch(() => {
        if (active) setStatus("Could not load history retention settings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.api]);

  const parsed = useMemo(
    () =>
      canonical === null
        ? undefined
        : parseDraft(draft, canonical.maximumEditableItems),
    [canonical, draft],
  );
  const changed =
    canonical !== null && parsed !== undefined && parsed !== canonical.maxItems;
  const willPrune =
    changed &&
    parsed !== null &&
    (canonical.maxItems === null || parsed < canonical.maxItems);

  const apply = async () => {
    if (props.disabled || busy || !changed) return;
    setBusy(true);
    props.onBusyChange(true);
    setStatus(null);
    try {
      const receipt = await props.api.setHistoryMaxItems(parsed);
      setCanonical(receipt.policy);
      setDraft(
        receipt.policy.maxItems === null ? "" : String(receipt.policy.maxItems),
      );
      props.onSnapshot(receipt.snapshot);
      setStatus("History retention updated. Save the vault to persist it.");
    } catch {
      setStatus("Could not update history retention.");
    } finally {
      setBusy(false);
      props.onBusyChange(false);
    }
  };

  return (
    <section
      className="settings-card"
      aria-labelledby="history-retention-title"
    >
      <div className="settings-page-heading compact-heading">
        <strong id="history-retention-title">History retention</strong>
        <p>
          Limit the number of prior revisions retained per entry. Leave blank
          for no finite item-count limit; use 0 to retain no revisions.
        </p>
      </div>
      {loading ? <p role="status">Loading history retention…</p> : null}
      {canonical === null ? null : (
        <div className="settings-form-grid">
          <label>
            <span>Maximum revisions per entry</span>
            <input
              inputMode="numeric"
              value={draft}
              disabled={props.disabled || busy}
              aria-invalid={parsed === undefined}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
              }}
            />
          </label>
          <p>
            Editable range: 0–{canonical.maximumEditableItems.toLocaleString()}.
            The KDBX HistoryMaxSize field is preserved but is not edited or
            enforced by this control.
          </p>
          {willPrune ? (
            <p role="note">
              Applying this lower limit immediately removes older revisions from
              the unlocked state. The file changes only after Save.
            </p>
          ) : null}
          <div className="settings-actions">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={props.disabled || busy || !changed}
              onClick={() => void apply()}
            >
              {busy ? "Updating…" : "Update history limit"}
            </Button>
          </div>
        </div>
      )}
      {status === null ? null : <p role="status">{status}</p>}
    </section>
  );
}
