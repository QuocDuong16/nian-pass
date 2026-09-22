import { useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type { VaultSnapshotDto } from "../../types/desktop";
import { AutoLockControl } from "./AutoLockControl";
import { KeyfileCredentialControl } from "./KeyfileCredentialControl";
import { MasterPasswordRotation } from "./MasterPasswordRotation";

interface VaultSecuritySettingsProps {
  api: DesktopApi;
  disabled: boolean;
  dirty: boolean;
  writable: boolean;
  hasDraft: boolean;
  mutationPending: boolean;
  autoLockMs: number | null;
  onAutoLockChange: ((timeoutMs: number | null) => void) | undefined;
  onBusyChange: (busy: boolean) => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
}

export function VaultSecuritySettings(props: VaultSecuritySettingsProps) {
  // Shared status prevents offering password removal after keyfile removal,
  // and exposes it immediately after a successful native keyfile addition.
  const [hasKeyfile, setHasKeyfile] = useState<boolean | null>(null);
  const credentialDisabled =
    props.disabled ||
    !props.writable ||
    props.hasDraft ||
    props.mutationPending ||
    props.dirty;

  return (
    <section
      className="settings-page"
      aria-labelledby="settings-security-title"
    >
      <div className="settings-page-heading">
        <p className="eyebrow">Session protection</p>
        <h3 id="settings-security-title">Security</h3>
        <p>Control session locking and the credential protecting this vault.</p>
      </div>
      <div className="settings-control-card">
        <div>
          <strong>Auto-lock</strong>
          <p>Lock the vault after a period without user activity.</p>
        </div>
        <AutoLockControl
          timeoutMs={props.autoLockMs}
          disabled={props.disabled}
          onChange={props.onAutoLockChange}
        />
      </div>
      <MasterPasswordRotation
        key={String(hasKeyfile)}
        hasKeyfile={hasKeyfile}
        api={props.api}
        disabled={credentialDisabled}
        dirty={props.dirty}
        onBusyChange={props.onBusyChange}
        onSnapshot={props.onSnapshot}
      />
      <KeyfileCredentialControl
        onKeyfileStateChange={setHasKeyfile}
        api={props.api}
        disabled={credentialDisabled}
        dirty={props.dirty}
        onBusyChange={props.onBusyChange}
      />
      <div className="settings-security-note">
        <strong>Privacy behavior</strong>
        <p>
          Revealed secrets are cleared when the app loses focus. Locking also
          drops the unlocked session credential and clears clipboard content
          owned by Nian Pass.
        </p>
      </div>
    </section>
  );
}
