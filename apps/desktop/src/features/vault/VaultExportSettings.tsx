import { useState } from "react";

import { Button } from "../../components/Button";
import { DesktopCommandError, type DesktopApi } from "../../lib/desktop";

interface VaultExportSettingsProps {
  api: DesktopApi;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}

export function VaultExportSettings(props: VaultExportSettingsProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const exportCopy = async () => {
    if (props.disabled || busy) return;
    setBusy(true);
    props.onBusyChange(true);
    setStatus(null);
    setFailure(null);
    try {
      const exported = await props.api.exportVaultCopy();
      if (exported) {
        setStatus(
          "Encrypted copy exported. The current vault remains selected.",
        );
      }
    } catch (error: unknown) {
      setFailure(exportFailureMessage(error));
    } finally {
      setBusy(false);
      props.onBusyChange(false);
    }
  };

  return (
    <section
      className="settings-export-copy"
      aria-labelledby="settings-export-copy-title"
    >
      <div>
        <strong id="settings-export-copy-title">Export encrypted copy</strong>
        <p>
          Write the current Rust-owned vault state to a new KDBX file. Existing
          files are never overwritten, and this does not change the selected
          vault or its Save/Sync binding.
        </p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        type="button"
        disabled={props.disabled || busy}
        onClick={() => {
          void exportCopy();
        }}
      >
        {busy ? "Exporting…" : "Export copy"}
      </Button>
      {status === null ? null : <p role="status">{status}</p>}
      {failure === null ? null : <p role="alert">{failure}</p>}
    </section>
  );
}

function exportFailureMessage(error: unknown): string {
  if (error instanceof DesktopCommandError) {
    if (error.code === "vault_already_exists") {
      return "Choose a new filename. Export never overwrites an existing file.";
    }
    if (error.code === "unsupported_write_format") {
      return "This KDBX format can be opened but cannot be exported by this build.";
    }
    if (error.code === "operation_in_progress") {
      return "Another vault operation is still in progress.";
    }
  }
  return "Could not export an encrypted copy. The current vault was not changed.";
}
