import { useState } from "react";

import { Button } from "../../components/Button";
import { DesktopCommandError, type DesktopApi } from "../../lib/desktop";
import type { EntryIconDto, VaultSnapshotDto } from "../../types/desktop";
import { entryIconLabel } from "./entry-icons";

interface Props {
  api: DesktopApi;
  entryId: string;
  icon: EntryIconDto;
  disabled: boolean;
  mutationDisabled: boolean;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onBusyChange: (busy: boolean) => void;
}

export function EntryCustomIconSection({
  api,
  entryId,
  icon,
  disabled,
  mutationDisabled,
  onSnapshot,
  onBusyChange,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const upload = async () => {
    if (disabled || mutationDisabled || busy) return;
    setBusy(true);
    setStatus(null);
    onBusyChange(true);
    try {
      const snapshot = await api.importEntryCustomIcon(entryId);
      if (snapshot === null) {
        setStatus("Custom icon upload cancelled.");
      } else {
        setStatus("Custom icon applied.");
        onSnapshot(snapshot);
      }
    } catch (error: unknown) {
      setStatus(
        error instanceof DesktopCommandError && error.code === "invalid_request"
          ? "Use a PNG up to 4 MiB with dimensions no larger than 4096 × 4096."
          : "Could not import the custom icon.",
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <section className="detail-field" aria-labelledby="entry-custom-icon-label">
      <div className="history-heading-row">
        <div>
          <h3 id="entry-custom-icon-label">Icon</h3>
          <p>{entryIconLabel(icon)}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={disabled || mutationDisabled || busy}
          onClick={() => void upload()}
        >
          {busy ? "Opening…" : "Upload PNG"}
        </Button>
      </div>
      <small>
        PNG only, up to 4 MiB and 4096 × 4096. Previous custom icons are kept
        when entry history still references them.
      </small>
      {status === null ? null : (
        <p className="copy-status" aria-live="polite">
          {status}
        </p>
      )}
    </section>
  );
}
