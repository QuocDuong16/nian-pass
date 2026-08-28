import { useState } from "react";

import type { VaultSnapshotDto } from "../../types/desktop";
import type { MobileApi, MobileSelectedVaultDto } from "../../types/mobile";
import { DirtyExitDialog } from "../vault/DirtyExitDialog";
import { MobileSaveDialogs } from "./MobileSaveDialogs";
import { MobileAutofillSettings } from "./MobileAutofillSettings";
import { MobileVaultBrowser } from "./MobileVaultBrowser";
import { useMobileSaveFlow } from "./useMobileSaveFlow";

interface Props {
  api: MobileApi;
  selected: MobileSelectedVaultDto;
  initialSnapshot: VaultSnapshotDto;
  hidden: boolean;
  onLocked: () => void;
}

export function MobileUnlockedView(props: Props) {
  const [snapshot, setSnapshot] = useState(props.initialSnapshot);
  const [hasDraft, setHasDraft] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const [lockPending, setLockPending] = useState(false);
  const [dirtyExit, setDirtyExit] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const flow = useMobileSaveFlow({
    api: props.api,
    dirty: snapshot.dirty,
    onSnapshot: setSnapshot,
    onLocked: props.onLocked,
    onLockPendingChange: setLockPending,
    onLockFailure: () => {
      setLockError(
        "The vault is saved, but Nian Pass could not safely release the active Android source.",
      );
    },
  });

  if (props.hidden) {
    return (
      <main className="security-shield">
        <section className="security-card">
          <h1>Vault hidden</h1>
          <p>Return to Nian Pass to continue.</p>
        </section>
      </main>
    );
  }

  const busy = flow.busy || mutationPending || lockPending;
  const editsDisabled = busy || !props.selected.writable || flow.blocked;
  const saveDisabled =
    busy ||
    hasDraft ||
    !snapshot.dirty ||
    !props.selected.writable ||
    flow.flow.kind !== "closed" ||
    flow.blocked;

  const lock = async () => {
    if (busy) return;
    setLockError(null);
    if (snapshot.dirty) {
      setDirtyExit(true);
      return;
    }
    setLockPending(true);
    try {
      await props.api.lockVault();
      props.onLocked();
    } catch {
      setLockError(
        "Nian Pass could not safely release the active Android source.",
      );
    } finally {
      setLockPending(false);
    }
  };

  const discard = async () => {
    if (busy) return;
    setLockPending(true);
    try {
      await props.api.discardChangesAndLock();
      props.onLocked();
    } catch {
      setDirtyExit(false);
      setLockError(
        "The dirty session remains open because discard-and-lock did not complete.",
      );
    } finally {
      setLockPending(false);
    }
  };

  return (
    <main className="mobile-vault-shell">
      <header className="top-bar mobile-top-bar">
        <div className="product-lockup">
          <span className="brand-mark small" aria-hidden="true">
            N
          </span>
          <div>
            <p className="eyebrow">
              Android ·{" "}
              {props.selected.writable ? "Explicit Save" : "Read only"}
            </p>
            <h1>Nian Pass</h1>
            <p className="mobile-file-name">{props.selected.fileName}</p>
            {snapshot.dirty ? (
              <p className="dirty-indicator" role="status">
                Unsaved changes
              </p>
            ) : null}
          </div>
        </div>
        <div className="top-bar-actions">
          <span className="save-status" aria-live="polite">
            {flow.saved && !snapshot.dirty ? "Saved" : ""}
          </span>
          <button
            type="button"
            aria-label="Save vault"
            disabled={saveDisabled}
            title={
              hasDraft
                ? "Apply or cancel the current draft before saving"
                : undefined
            }
            onClick={() => {
              flow.start("save");
            }}
          >
            Save
          </button>
          <button
            className="secondary-button lock-button"
            type="button"
            disabled={busy || flow.blocked}
            onClick={() => void lock()}
          >
            Lock
          </button>
        </div>
      </header>
      {!props.selected.writable ? (
        <p className="shell-error" role="status">
          This provider did not grant persistent writable access. Browsing
          remains available; editing and Save are disabled.
        </p>
      ) : null}
      {lockError === null ? null : (
        <p className="shell-error" role="alert">
          {lockError}
        </p>
      )}
      <MobileAutofillSettings api={props.api} />
      <MobileVaultBrowser
        api={props.api}
        snapshot={snapshot}
        disabled={editsDisabled}
        onSnapshot={setSnapshot}
        onDraftChange={setHasDraft}
        onBusyChange={setMutationPending}
      />
      {dirtyExit ? (
        <DirtyExitDialog
          intent="lock"
          busy={busy}
          onCancel={() => {
            setDirtyExit(false);
          }}
          onDiscard={() => void discard()}
          onSave={() => {
            setDirtyExit(false);
            flow.start("lock");
          }}
        />
      ) : null}
      <MobileSaveDialogs
        flow={flow.flow}
        password={flow.password}
        onPassword={flow.setPassword}
        onCancel={flow.cancel}
        onSave={() => void flow.submitSave()}
        onReloadChoice={flow.beginReload}
        onReloadCancel={flow.cancelReload}
        onReload={() => void flow.submitReload()}
        onDismissUncertain={flow.dismissUncertain}
      />
    </main>
  );
}
