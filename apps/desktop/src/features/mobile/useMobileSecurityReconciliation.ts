import { useEffect } from "react";

import type { MobileSecurityResumeDto } from "../../types/mobile";
import type { MobileSecurityAttention } from "./MobileSecurityShield";

interface Options {
  attention: MobileSecurityAttention | null;
  busy: boolean;
  hasDraft: boolean;
  hidden: boolean;
  readOnly: boolean;
  refreshing: boolean;
  snapshotDirty: boolean;
  status: MobileSecurityResumeDto | null;
  setAttention: (attention: MobileSecurityAttention) => void;
  onAcknowledge: (generation: number) => Promise<boolean>;
  onLocked: () => void;
  onRefresh: () => Promise<MobileSecurityResumeDto | null>;
  runCleanLock: (generation: number | null) => Promise<void>;
}

export function useMobileSecurityReconciliation(options: Options) {
  const {
    attention,
    busy,
    hasDraft,
    hidden,
    onAcknowledge,
    onLocked,
    onRefresh,
    readOnly,
    refreshing,
    runCleanLock,
    setAttention,
    snapshotDirty,
    status,
  } = options;

  useEffect(() => {
    if (readOnly || !hidden || refreshing) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      if (status === null) setAttention("locking");
      else if (status.vaultState === "locked") onLocked();
      else if (attention === "lock_error") return;
      else if (hasDraft) setAttention("draft");
      else if (status.vaultState === "dirty" || snapshotDirty) {
        setAttention("dirty");
      } else if (status.operationPending || busy) {
        setAttention("locking");
        void onRefresh();
      } else void runCleanLock(status.generation);
    });
    return () => {
      active = false;
    };
  }, [
    attention,
    busy,
    hasDraft,
    hidden,
    onLocked,
    onRefresh,
    readOnly,
    refreshing,
    runCleanLock,
    setAttention,
    snapshotDirty,
    status,
  ]);

  useEffect(() => {
    if (
      readOnly ||
      !hidden ||
      refreshing ||
      status === null ||
      !status.foreground ||
      status.screenState !== "active" ||
      (attention !== "dirty" &&
        attention !== "draft" &&
        attention !== "lock_error")
    ) {
      return;
    }
    void onAcknowledge(status.generation);
  }, [attention, hidden, onAcknowledge, readOnly, refreshing, status]);

  useEffect(() => {
    if (!hidden || busy || status?.operationPending !== true) return;
    void onRefresh();
  }, [busy, hidden, onRefresh, status?.operationPending]);
}
