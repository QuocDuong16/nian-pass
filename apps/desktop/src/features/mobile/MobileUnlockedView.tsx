import { useEffect, useRef, useState } from "react";

import type { VaultSnapshotDto } from "../../types/desktop";
import type {
  MobileApi,
  MobileSecurityResumeDto,
  MobileSelectedVaultDto,
} from "../../types/mobile";
import type { RuntimePlatform } from "../../types/runtime";
import { DirtyExitDialog } from "../vault/DirtyExitDialog";
import { MobileAutofillSettings } from "./MobileAutofillSettings";
import { MobileSaveDialogs } from "./MobileSaveDialogs";
import {
  MobileSecurityShield,
  type MobileSecurityAttention,
} from "./MobileSecurityShield";
import { MobileVaultBrowser } from "./MobileVaultBrowser";
import { MobileUnlockedHeader } from "./MobileUnlockedHeader";
import { useMobileSaveFlow } from "./useMobileSaveFlow";
import { useMobileUnlockedSecurity } from "./useMobileUnlockedSecurity";

interface Props {
  api: MobileApi;
  selected: MobileSelectedVaultDto;
  initialSnapshot: VaultSnapshotDto;
  hidden: boolean;
  securityStatus: MobileSecurityResumeDto | null;
  securityRefreshing: boolean;
  onAcknowledgeSafeUi: (generation: number) => Promise<boolean>;
  onRefreshSecurity: () => Promise<MobileSecurityResumeDto | null>;
  timeoutMs: number | null;
  onTimeout: (timeoutMs: number | null) => void;
  platform: Extract<RuntimePlatform, "android" | "ios">;
  onLocked: () => void;
}

export function MobileUnlockedView(props: Props) {
  const readOnly = props.platform === "ios";
  const [snapshot, setSnapshot] = useState(props.initialSnapshot);
  const [hasDraft, setHasDraft] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const [mutationPending, setMutationPending] = useState(false);
  const [lockPending, setLockPending] = useState(false);
  const [dirtyExit, setDirtyExit] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [attention, setAttention] = useState<MobileSecurityAttention | null>(
    null,
  );
  const [securitySaveFlow, setSecuritySaveFlow] = useState(false);
  const recordActivityRef = useRef<() => void>(() => undefined);

  const flow = useMobileSaveFlow({
    api: props.api,
    dirty: snapshot.dirty,
    onSnapshot: setSnapshot,
    onLocked: props.onLocked,
    onLockPendingChange: (pending) => {
      setLockPending(pending);
      if (pending) {
        setAttention((current) => (current === null ? null : "locking"));
      }
    },
    onLockFailure: () => {
      setSecuritySaveFlow(false);
      setLockError(
        "The vault is saved, but Nian Pass could not safely release the active Android source.",
      );
      setAttention((current) => (current === null ? null : "lock_error"));
    },
    onSaveCompleted: () => {
      recordActivityRef.current();
    },
  });

  const security = useMobileUnlockedSecurity({
    api: props.api,
    readOnly,
    hidden: props.hidden,
    securityStatus: props.securityStatus,
    securityRefreshing: props.securityRefreshing,
    snapshot,
    hasDraft,
    mutationPending,
    flowBusy: flow.busy,
    lockPending,
    setLockPending,
    attention,
    setAttention,
    setLockError,
    setDirtyExit,
    timeoutMs: props.timeoutMs,
    onDiscardDraft: () => {
      setDraftVersion((value) => value + 1);
      setHasDraft(false);
    },
    onLocked: props.onLocked,
    onAcknowledgeSafeUi: props.onAcknowledgeSafeUi,
    onRefreshSecurity: props.onRefreshSecurity,
  });
  useEffect(() => {
    recordActivityRef.current = security.recordActivity;
  }, [security.recordActivity]);
  const secureForBoundary = flow.secureForBoundary;
  useEffect(() => {
    if (!props.hidden) return;
    secureForBoundary();
  }, [props.hidden, secureForBoundary]);
  useEffect(() => {
    if (attention === null || securitySaveFlow) return;
    secureForBoundary();
  }, [attention, secureForBoundary, securitySaveFlow]);

  const busy = security.busy;

  const contentHidden = props.hidden || attention !== null;
  const backgrounded =
    props.securityStatus !== null
      ? !props.securityStatus.foreground ||
        props.securityStatus.screenState !== "active"
      : props.hidden;
  const editsDisabled =
    busy || !props.selected.writable || flow.blocked || contentHidden;
  const saveDisabled =
    busy ||
    hasDraft ||
    !snapshot.dirty ||
    !props.selected.writable ||
    flow.flow.kind !== "closed" ||
    flow.blocked ||
    contentHidden;
  const securityCredentialVisible =
    contentHidden &&
    !backgrounded &&
    securitySaveFlow &&
    flow.flow.kind === "credential" &&
    flow.flow.intent === "lock";

  return (
    <>
      <div hidden={contentHidden} aria-hidden={contentHidden}>
        <main className="mobile-vault-shell">
          <MobileUnlockedHeader
            platform={props.platform}
            selected={props.selected}
            dirty={snapshot.dirty}
            hasDraft={hasDraft}
            readOnly={readOnly}
            busy={busy}
            blocked={flow.blocked}
            saved={flow.saved}
            saveDisabled={saveDisabled}
            timeoutMs={props.timeoutMs}
            onTimeout={(next) => {
              props.onTimeout(next);
              security.recordActivity();
            }}
            onSave={() => {
              flow.start("save");
            }}
            onLock={() => void security.requestManualLock()}
          />
          {!props.selected.writable && !readOnly ? (
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
          <MobileAutofillSettings api={props.api} platform={props.platform} />
          <MobileVaultBrowser
            key={draftVersion}
            api={props.api}
            snapshot={snapshot}
            disabled={editsDisabled}
            readOnly={readOnly}
            onSnapshot={setSnapshot}
            onDraftChange={setHasDraft}
            onBusyChange={setMutationPending}
          />
          {dirtyExit && !readOnly ? (
            <DirtyExitDialog
              intent="lock"
              busy={busy}
              onCancel={() => {
                setDirtyExit(false);
              }}
              onDiscard={() => {
                void security.discardAndLock(false);
              }}
              onSave={() => {
                setDirtyExit(false);
                flow.start("lock");
              }}
            />
          ) : null}
        </main>
      </div>
      {contentHidden && !securityCredentialVisible ? (
        <MobileSecurityShield
          attention={attention ?? "locking"}
          backgrounded={backgrounded}
          refreshing={props.securityRefreshing}
          onContinue={security.continueEditing}
          onDiscardDraft={security.discardDraft}
          onSaveAndLock={() => {
            setSecuritySaveFlow(true);
            flow.start("lock");
          }}
          onDiscardAndLock={() => {
            void security.discardAndLock(true);
          }}
          onRetryLock={() => {
            security.retryCleanLock();
          }}
        />
      ) : null}
      {readOnly || (contentHidden && !securityCredentialVisible) ? null : (
        <MobileSaveDialogs
          flow={flow.flow}
          password={flow.password}
          onPassword={flow.setPassword}
          onCancel={() => {
            flow.cancel();
            setSecuritySaveFlow(false);
          }}
          onSave={() => void flow.submitSave()}
          onReloadChoice={flow.beginReload}
          onReloadCancel={flow.cancelReload}
          onReload={() => void flow.submitReload()}
          onDismissUncertain={flow.dismissUncertain}
        />
      )}
    </>
  );
}
