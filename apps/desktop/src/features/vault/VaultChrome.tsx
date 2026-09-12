import { useEffect, useRef } from "react";

import { Button } from "../../components/Button";
import { SearchInput } from "../../components/Input";
import { StatusBadge } from "../../components/StatusBadge";
import type { DesktopApi } from "../../lib/desktop";
import type { VaultSnapshotDto } from "../../types/desktop";
import { SyncSection } from "../sync/SyncSection";
import { AutoLockControl } from "./AutoLockControl";

interface VaultTopBarProps {
  snapshot: VaultSnapshotDto;
  searchQuery: string;
  saveStatus: "idle" | "saving" | "saved";
  saveUnavailable: boolean;
  hasDraft: boolean;
  disabled: boolean;
  mutationPending: boolean;
  shortcutsDisabled: boolean;
  onSearch: (value: string) => void;
  onSave: () => void;
  onLock: () => void;
  onSettings: () => void;
}

export function VaultTopBar(props: VaultTopBarProps) {
  const readOnly = !props.snapshot.capabilities.writable;
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (props.shortcutsDisabled || event.altKey) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => {
      window.removeEventListener("keydown", focusSearch);
    };
  }, [props.shortcutsDisabled]);
  return (
    <header className="top-bar">
      <div className="product-lockup compact">
        <span className="brand-mark small" aria-hidden="true">
          N
        </span>
        <span className="product-context">
          <strong>Nian Pass</strong>
          <span className="top-file-name" title={props.snapshot.fileName}>
            {props.snapshot.fileName}
          </span>
        </span>
      </div>
      <SearchInput
        ref={searchRef}
        aria-label="Search vault"
        title="Search vault (Ctrl/Cmd+K)"
        placeholder="Search vault…"
        value={props.searchQuery}
        onChange={(event) => {
          props.onSearch(event.currentTarget.value);
        }}
        onClear={() => {
          props.onSearch("");
        }}
      />
      <div className="top-bar-actions">
        {readOnly ? (
          <StatusBadge tone="warning">Read-only</StatusBadge>
        ) : props.snapshot.dirty ? (
          <StatusBadge tone="warning">Unsaved</StatusBadge>
        ) : (
          <StatusBadge tone="success">Saved</StatusBadge>
        )}
        <span className="save-status" aria-live="polite">
          {props.saveStatus === "saving"
            ? "Saving…"
            : props.saveStatus === "saved"
              ? "Saved"
              : ""}
        </span>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={props.onSettings}
        >
          Settings
        </Button>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          aria-label="Save vault"
          disabled={props.saveUnavailable}
          title={
            props.hasDraft
              ? "Apply or cancel the current draft before saving"
              : undefined
          }
          onClick={props.onSave}
        >
          {props.saveStatus === "saving" ? "Saving…" : "Save"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={props.disabled || props.mutationPending}
          onClick={props.onLock}
        >
          Lock
        </Button>
      </div>
    </header>
  );
}

export function VaultReadOnlyNotice({
  snapshot,
}: {
  snapshot: VaultSnapshotDto;
}) {
  const message = (() => {
    switch (snapshot.capabilities.writeRestriction) {
      case "unsupported_write_format":
        return `KDBX ${snapshot.capabilities.formatVersion} · Read-only in Nian Pass. This vault can be opened, but this version cannot currently be saved safely.`;
      case "unsupported_persistence_platform":
        return "Read-only on this platform. Nian Pass can open this vault here, but safe write persistence is not supported.";
      case "read_only_source":
        return "Read-only source. Browsing, reveal, and copy remain available, but changes are disabled.";
      case null:
        return null;
    }
  })();
  return message === null ? null : (
    <div className="read-only-notice" role="status">
      {message}
    </div>
  );
}

export function VaultStatusBar({ snapshot }: { snapshot: VaultSnapshotDto }) {
  return (
    <footer className="vault-status-bar">
      <span>{snapshot.fileName}</span>
      <span>·</span>
      <span>{snapshot.dirty ? "Unsaved changes" : "Saved"}</span>
      <span>·</span>
      <span>KDBX {snapshot.capabilities.formatVersion}</span>
      <span>·</span>
      <span>{snapshot.capabilities.writable ? "Writable" : "Read-only"}</span>
    </footer>
  );
}

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

export function VaultSettingsDialog(props: VaultSettingsDialogProps) {
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

  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Nian Pass</p>
            <h2 id="settings-title">Settings</h2>
          </div>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={props.onClose}
          >
            Close
          </Button>
        </div>
        <section className="settings-section">
          <h3>Security</h3>
          <AutoLockControl
            timeoutMs={props.autoLockMs}
            disabled={props.disabled}
            onChange={props.onAutoLockChange}
          />
        </section>
        <section className="settings-section">
          <h3>Sync</h3>
          <SyncSection
            api={props.api}
            disabled={
              props.disabled ||
              !props.snapshot.capabilities.writable ||
              props.hasDraft ||
              props.mutationPending ||
              props.snapshot.dirty
            }
            onBusyChange={props.onBusyChange}
            onSnapshot={props.onSnapshot}
          />
        </section>
      </section>
    </div>
  );
}
