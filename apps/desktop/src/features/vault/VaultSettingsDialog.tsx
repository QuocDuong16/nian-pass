import { useEffect, useState } from "react";

import { Button } from "../../components/Button";
import type { DesktopApi } from "../../lib/desktop";
import type { VaultSnapshotDto } from "../../types/desktop";
import { SyncSection } from "../sync/SyncSection";
import { VaultSecuritySettings } from "./VaultSecuritySettings";
import { VaultRecycleBinSettings } from "./VaultRecycleBinSettings";
import { VaultDatabaseMetadataSettings } from "./VaultDatabaseMetadataSettings";
import { VaultExportSettings } from "./VaultExportSettings";
import { VaultHistorySettings } from "./VaultHistorySettings";
import { PasswordHealthReportSection } from "./PasswordHealthReportSection";

type SettingsPage = "general" | "security" | "reports" | "sync";

interface VaultSettingsDialogProps {
  api: DesktopApi;
  snapshot: VaultSnapshotDto;
  disabled: boolean;
  hasDraft: boolean;
  mutationPending: boolean;
  autoLockMs: number | null;
  onAutoLockChange?: ((timeoutMs: number | null) => void) | undefined;
  onBusyChange: (busy: boolean) => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onClose: () => void;
}

const pages: { id: SettingsPage; label: string; hint: string }[] = [
  { id: "general", label: "General", hint: "Vault information" },
  { id: "security", label: "Security", hint: "Lock and privacy" },
  { id: "reports", label: "Reports", hint: "Password health" },
  { id: "sync", label: "Sync", hint: "Remote vault copies" },
];

export function VaultSettingsDialog(props: VaultSettingsDialogProps) {
  const [page, setPage] = useState<SettingsPage>("general");
  const { onClose } = props;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const syncDisabled =
    props.disabled ||
    !props.snapshot.capabilities.writable ||
    props.hasDraft ||
    props.mutationPending ||
    props.snapshot.dirty;

  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-header">
          <div>
            <p className="eyebrow">Nian Pass</p>
            <h2 id="settings-title">Settings</h2>
          </div>
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {pages.map((item) => (
              <button
                key={item.id}
                className={`settings-nav-item${page === item.id ? " selected" : ""}`}
                type="button"
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => {
                  setPage(item.id);
                }}
              >
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {page === "general" ? (
              <GeneralSettings
                api={props.api}
                snapshot={props.snapshot}
                disabled={
                  props.disabled ||
                  props.hasDraft ||
                  props.mutationPending ||
                  props.snapshot.capabilities.formatVersion !== "4.1"
                }
                onBusyChange={props.onBusyChange}
                onSnapshot={props.onSnapshot}
              />
            ) : null}
            {page === "security" ? (
              <VaultSecuritySettings
                api={props.api}
                disabled={props.disabled}
                dirty={props.snapshot.dirty}
                writable={props.snapshot.capabilities.writable}
                hasDraft={props.hasDraft}
                mutationPending={props.mutationPending}
                autoLockMs={props.autoLockMs}
                onAutoLockChange={props.onAutoLockChange}
                onBusyChange={props.onBusyChange}
                onSnapshot={props.onSnapshot}
              />
            ) : null}
            {page === "reports" ? (
              <PasswordHealthReportSection
                api={props.api}
                disabled={props.disabled}
              />
            ) : null}
            {page === "sync" ? (
              <section
                className="settings-page"
                aria-labelledby="settings-sync-title"
              >
                <div className="settings-page-heading">
                  <p className="eyebrow">Remote copies</p>
                  <h3 id="settings-sync-title">Sync</h3>
                  <p>
                    Configure one remote target at a time. Credentials are used
                    for the current operation and are not stored in the profile.
                  </p>
                </div>
                <SyncSection
                  embedded
                  api={props.api}
                  disabled={syncDisabled}
                  onBusyChange={props.onBusyChange}
                  onSnapshot={props.onSnapshot}
                />
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function GeneralSettings({
  api,
  snapshot,
  disabled,
  onBusyChange,
  onSnapshot,
}: {
  api: DesktopApi;
  snapshot: VaultSnapshotDto;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
}) {
  return (
    <section className="settings-page" aria-labelledby="settings-general-title">
      <div className="settings-page-heading">
        <p className="eyebrow">Current database</p>
        <h3 id="settings-general-title">General</h3>
        <p>
          Review the vault that is currently open and its persistence state.
        </p>
      </div>
      <dl className="settings-summary-grid">
        <SummaryItem label="Database" value={snapshot.fileName} />
        <SummaryItem
          label="Format"
          value={`KDBX ${snapshot.capabilities.formatVersion}`}
        />
        <SummaryItem
          label="Access"
          value={snapshot.capabilities.writable ? "Writable" : "Read-only"}
        />
        <SummaryItem
          label="Changes"
          value={snapshot.dirty ? "Unsaved changes" : "Saved"}
        />
        <SummaryItem label="Groups" value={String(snapshot.groups.length)} />
        <SummaryItem label="Entries" value={String(snapshot.entries.length)} />
      </dl>
      <VaultExportSettings
        api={api}
        disabled={disabled}
        onBusyChange={onBusyChange}
      />
      <VaultDatabaseMetadataSettings
        api={api}
        disabled={disabled}
        onBusyChange={onBusyChange}
        onSnapshot={onSnapshot}
      />
      <VaultHistorySettings
        api={api}
        disabled={disabled}
        onBusyChange={onBusyChange}
        onSnapshot={onSnapshot}
      />
      <VaultRecycleBinSettings
        api={api}
        snapshot={snapshot}
        disabled={disabled}
        onBusyChange={onBusyChange}
        onSnapshot={onSnapshot}
      />
      <p className="settings-callout">
        History size limits and encryption parameters are not editable in this
        build yet.
      </p>
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-summary-item">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}
