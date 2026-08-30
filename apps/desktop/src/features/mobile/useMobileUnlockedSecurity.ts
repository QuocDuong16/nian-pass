import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";

import { MobileCommandError } from "../../lib/mobile";
import type { VaultSnapshotDto } from "../../types/desktop";
import type { MobileApi, MobileSecurityResumeDto } from "../../types/mobile";
import type { MobileSecurityAttention } from "./MobileSecurityShield";
import { useMobileIdleSecurity } from "./useMobileIdleSecurity";

interface Options {
  api: MobileApi;
  readOnly: boolean;
  hidden: boolean;
  securityStatus: MobileSecurityResumeDto | null;
  securityRefreshing: boolean;
  snapshot: VaultSnapshotDto;
  hasDraft: boolean;
  mutationPending: boolean;
  flowBusy: boolean;
  clearSaveCredential: () => void;
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
  const lockAttemptGeneration = useRef<number | null>(null);
  const resetActivityAfterAttention = useRef(false);
  const currentAttention = options.attention;
  const hidden = options.hidden;
  const clearSaveCredential = options.clearSaveCredential;
  const busy =
    (!options.readOnly && options.flowBusy) ||
    options.mutationPending ||
    options.lockPending;

  const runCleanLock = useCallback(
    async (generation: number | null) => {
      if (options.lockPending || options.mutationPending || options.flowBusy) {
        options.setAttention("locking");
        void options.onRefreshSecurity();
        return;
      }
      if (generation !== null && lockAttemptGeneration.current === generation) {
        return;
      }
      lockAttemptGeneration.current = generation;
      if (generation !== null) options.setAttention("locking");
      options.setLockPending(true);
      options.setLockError(null);
      try {
        await options.api.lockVault();
        options.onLocked();
      } catch (error) {
        if (error instanceof MobileCommandError && error.code === "busy") {
          lockAttemptGeneration.current = null;
          void options.onRefreshSecurity();
        } else {
          options.setLockError(
            "Nian Pass could not safely release the active document source.",
          );
          options.setAttention(generation === null ? null : "lock_error");
        }
      } finally {
        options.setLockPending(false);
      }
    },
    [options],
  );

  const onIdleExpired = useCallback(() => {
    if (options.hasDraft) {
      options.setAttention("draft");
    } else if (options.snapshot.dirty) {
      options.setAttention("dirty");
    } else {
      void runCleanLock(options.securityStatus?.generation ?? null);
    }
  }, [options, runCleanLock]);

  const idle = useMobileIdleSecurity({
    enabled: !options.readOnly,
    timeoutMs: options.timeoutMs,
    paused: busy,
    shielded: options.hidden || options.attention !== null,
    status: options.securityStatus,
    onExpired: onIdleExpired,
  });

  useEffect(() => {
    if (currentAttention !== null || !resetActivityAfterAttention.current)
      return;
    resetActivityAfterAttention.current = false;
    idle.recordActivity();
  }, [currentAttention, idle]);

  useEffect(() => {
    if (hidden) clearSaveCredential();
  }, [clearSaveCredential, hidden]);

  useEffect(() => {
    if (options.readOnly || !options.hidden || options.securityRefreshing)
      return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const status = options.securityStatus;
      if (status === null) {
        options.setAttention("locking");
      } else if (status.vaultState === "locked") {
        options.onLocked();
      } else if (options.attention === "lock_error") {
        return;
      } else if (options.hasDraft) {
        options.setAttention("draft");
      } else if (status.vaultState === "dirty" || options.snapshot.dirty) {
        options.setAttention("dirty");
      } else if (status.operationPending || busy) {
        options.setAttention("locking");
        void options.onRefreshSecurity();
      } else {
        void runCleanLock(status.generation);
      }
    });
    return () => {
      active = false;
    };
  }, [busy, options, runCleanLock]);

  useEffect(() => {
    const status = options.securityStatus;
    if (
      options.readOnly ||
      !options.hidden ||
      options.securityRefreshing ||
      status === null ||
      !status.foreground ||
      status.screenState !== "active" ||
      (options.attention !== "dirty" &&
        options.attention !== "draft" &&
        options.attention !== "lock_error")
    ) {
      return;
    }
    void options.onAcknowledgeSafeUi(status.generation);
  }, [options]);

  useEffect(() => {
    if (
      !options.hidden ||
      busy ||
      options.securityStatus?.operationPending !== true
    )
      return;
    void options.onRefreshSecurity();
  }, [busy, options]);

  const requestManualLock = async () => {
    if (busy) return;
    options.setLockError(null);
    if (options.hasDraft) options.setAttention("draft");
    else if (options.snapshot.dirty) options.setDirtyExit(true);
    else await runCleanLock(null);
  };

  const discardAndLock = async (securityBoundary: boolean) => {
    if (busy) return;
    options.setAttention("locking");
    options.setLockPending(true);
    try {
      await options.api.discardChangesAndLock();
      options.onLocked();
    } catch {
      options.setDirtyExit(false);
      options.setLockError(
        "The dirty session remains open because discard-and-lock did not complete.",
      );
      options.setAttention(securityBoundary ? "dirty" : null);
      const generation = options.securityStatus?.generation;
      if (generation !== undefined) {
        void options.onAcknowledgeSafeUi(generation);
      }
    } finally {
      options.setLockPending(false);
    }
  };

  const continueEditing = () => {
    resetActivityAfterAttention.current = true;
    options.setAttention(null);
    options.setLockError(null);
    lockAttemptGeneration.current = null;
    const generation = options.securityStatus?.generation;
    if (options.hidden && generation !== undefined) {
      void options.onAcknowledgeSafeUi(generation);
    }
  };

  const discardDraft = () => {
    options.onDiscardDraft();
    if (
      options.snapshot.dirty ||
      options.securityStatus?.vaultState === "dirty"
    ) {
      options.setAttention("dirty");
    } else {
      void runCleanLock(options.securityStatus?.generation ?? null);
    }
  };

  return {
    busy,
    recordActivity: idle.recordActivity,
    requestManualLock,
    discardAndLock,
    continueEditing,
    discardDraft,
    retryCleanLock: () => {
      lockAttemptGeneration.current = null;
      void runCleanLock(options.securityStatus?.generation ?? null);
    },
  };
}
