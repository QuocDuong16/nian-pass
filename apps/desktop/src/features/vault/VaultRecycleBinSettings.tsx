import { useState } from "react";

import { Button } from "../../components/Button";
import { DesktopCommandError, type DesktopApi } from "../../lib/desktop";
import type { VaultSnapshotDto } from "../../types/desktop";

interface VaultRecycleBinSettingsProps {
  api: DesktopApi;
  snapshot: VaultSnapshotDto;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
}

export function VaultRecycleBinSettings(props: VaultRecycleBinSettingsProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const enabled = props.snapshot.recycleBinEnabled;
  const actionDisabled =
    props.disabled || busy || !props.snapshot.capabilities.writable;

  const apply = async () => {
    if (actionDisabled) return;
    setBusy(true);
    props.onBusyChange(true);
    setStatus(null);
    try {
      const snapshot = await props.api.setRecycleBinEnabled(!enabled);
      props.onSnapshot(snapshot);
      setStatus(
        snapshot.recycleBinEnabled ? "Trash enabled." : "Trash disabled.",
      );
    } catch (error: unknown) {
      if (
        error instanceof DesktopCommandError &&
        error.code === "invalid_request" &&
        enabled
      ) {
        setStatus("Empty Trash before disabling it.");
      } else {
        setStatus("Could not change the Trash setting.");
      }
    } finally {
      setBusy(false);
      props.onBusyChange(false);
    }
  };

  return (
    <section className="settings-card" aria-labelledby="settings-trash-title">
      <div>
        <strong id="settings-trash-title">Trash</strong>
        <p>
          {enabled
            ? "Deleted items move to Trash and can be restored."
            : "Trash is disabled; delete actions that require it are unavailable."}
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        type="button"
        disabled={actionDisabled}
        onClick={() => void apply()}
      >
        {busy ? "Updating…" : enabled ? "Disable Trash" : "Enable Trash"}
      </Button>
      {status === null ? null : <p role="status">{status}</p>}
    </section>
  );
}
