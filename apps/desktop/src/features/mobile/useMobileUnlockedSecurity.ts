import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";

import { MobileCommandError } from "../../lib/mobile";
import type { MobileVaultSnapshotDto } from "../../types/mobile";
import type { MobileApi, MobileSecurityResumeDto } from "../../types/mobile";
import type { MobileSecurityAttention } from "./MobileSecurityShield";
import { useMobileIdleSecurity } from "./useMobileIdleSecurity";
import { useMobileSecurityReconciliation } from "./useMobileSecurityReconciliation";

interface Options {
  api: MobileApi;
  readOnly: boolean;
  hidden: boolean;
  securityStatus: MobileSecurityResumeDto | null;
  securityRefreshing: boolean;
  snapshot: MobileVaultSnapshotDto;
  hasDraft: boolean;
  mutationPending: boolean;
  flowBusy: boolean;
  lockPending: boolean;
  setLockPending: Dispatch<SetStateAction<boolean>>;
  attention: MobileSecurityAttention | null;
  setAttention: Dispatch<SetStateAction<MobileSecurityAttention | null>>;
  setLockError: Dispatch<SetStateAction<string | null>>;
  setDirtyExit: Dispatch<SetStateAction<boolean>>;
  timeoutMs: number | null;
  onDiscardDraft: () => void;
  onLocked: () => void;
  onAcknowledgeSafeUi: (generation: number) => Promise<boolean>;
  onRefreshSecurity: () => Promise<MobileSecurityResumeDto | null>;
}

export function useMobileUnlockedSecurity(options: Options) {
  const {
    api,
    attention,
    flowBusy,
    hasDraft,
    hidden,
    lockPending,
    mutationPending,
    onAcknowledgeSafeUi,
    onDiscardDraft,
    onLocked,
    onRefreshSecurity,
    readOnly,
    securityRefreshing,
    securityStatus,
    setAttention,
    setDirtyExit,
    setLockError,
    setLockPending,
    snapshot,
    timeoutMs,
  } = options;
  const lockAttemptGeneration = useRef<number | null>(null);
  const resetActivityAfterAttention = useRef(false);
  const busy = (!readOnly && flowBusy) || mutationPending || lockPending;

  const runCleanLock = useCallback(
    async (generation: number | null) => {
      if (lockPending || mutationPending || flowBusy) {
        setAttention("locking");
        void onRefreshSecurity();
        return;
      }
      if (generation !== null && lockAttemptGeneration.current === generation) {
        return;
      }
      lockAttemptGeneration.current = generation;
      if (generation !== null) setAttention("locking");
      setLockPending(true);
      setLockError(null);
      try {
        await api.lockVault();
        onLocked();
      } catch (error) {
        if (error instanceof MobileCommandError && error.code === "busy") {
          lockAttemptGeneration.current = null;
          void onRefreshSecurity();
        } else {
          setLockError(
            "Nian Pass could not safely release the active document source.",
          );
          setAttention(generation === null ? null : "lock_error");
        }
      } finally {
        setLockPending(false);
      }
    },
    [
      api,
      flowBusy,
      lockPending,
      mutationPending,
      onLocked,
      onRefreshSecurity,
      setAttention,
      setLockError,
      setLockPending,
    ],
  );

  const onIdleExpired = useCallback(() => {
    if (hasDraft) {
      setAttention("draft");
    } else if (snapshot.dirty) {
      setAttention("dirty");
    } else {
      void runCleanLock(securityStatus?.generation ?? null);
    }
  }, [
    hasDraft,
    runCleanLock,
    securityStatus?.generation,
    setAttention,
    snapshot.dirty,
  ]);

  const { recordActivity } = useMobileIdleSecurity({
    enabled: !readOnly,
    timeoutMs,
    paused: busy,
    shielded: hidden || attention !== null,
    status: securityStatus,
    onExpired: onIdleExpired,
  });

  useEffect(() => {
    if (attention !== null || !resetActivityAfterAttention.current) return;
    resetActivityAfterAttention.current = false;
    recordActivity();
  }, [attention, recordActivity]);

  useMobileSecurityReconciliation({
    attention,
    busy,
    hasDraft,
    hidden,
    readOnly,
    refreshing: securityRefreshing,
    snapshotDirty: snapshot.dirty,
    status: securityStatus,
    setAttention,
    onAcknowledge: onAcknowledgeSafeUi,
    onLocked,
    onRefresh: onRefreshSecurity,
    runCleanLock,
  });

  const requestManualLock = async () => {
    if (busy) return;
    setLockError(null);
    if (hasDraft) setAttention("draft");
    else if (snapshot.dirty) setDirtyExit(true);
    else await runCleanLock(null);
  };

  const discardAndLock = async (securityBoundary: boolean) => {
    if (busy) return;
    setAttention("locking");
    setLockPending(true);
    try {
      await api.discardChangesAndLock();
      onLocked();
    } catch {
      setDirtyExit(false);
      setLockError(
        "The dirty session remains open because discard-and-lock did not complete.",
      );
      setAttention(securityBoundary ? "dirty" : null);
      const generation = securityStatus?.generation;
      if (generation !== undefined) {
        void onAcknowledgeSafeUi(generation);
      }
    } finally {
      setLockPending(false);
    }
  };

  const continueEditing = () => {
    resetActivityAfterAttention.current = true;
    setAttention(null);
    setLockError(null);
    lockAttemptGeneration.current = null;
    const generation = securityStatus?.generation;
    if (hidden && generation !== undefined) {
      void onAcknowledgeSafeUi(generation);
    }
  };

  const discardDraft = () => {
    onDiscardDraft();
    if (snapshot.dirty || securityStatus?.vaultState === "dirty") {
      setAttention("dirty");
    } else {
      void runCleanLock(securityStatus?.generation ?? null);
    }
  };

  return {
    busy,
    recordActivity,
    requestManualLock,
    discardAndLock,
    continueEditing,
    discardDraft,
    retryCleanLock: () => {
      lockAttemptGeneration.current = null;
      void runCleanLock(securityStatus?.generation ?? null);
    },
  };
}
