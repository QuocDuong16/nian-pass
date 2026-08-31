import { useEffect } from "react";

import type { MobileSecurityResumeDto } from "../../types/mobile";

interface Options {
  enabled: boolean;
  lockedUi: boolean;
  refreshing: boolean;
  shielded: boolean;
  status: MobileSecurityResumeDto | null;
  acknowledge: (generation: number) => Promise<boolean>;
}

export function useAcknowledgeLockedMobileUi(options: Options) {
  const { acknowledge, enabled, lockedUi, refreshing, shielded, status } =
    options;
  useEffect(() => {
    if (
      !enabled ||
      !lockedUi ||
      status === null ||
      refreshing ||
      !shielded ||
      !status.foreground ||
      status.screenState !== "active"
    ) {
      return;
    }
    void acknowledge(status.generation);
  }, [acknowledge, enabled, lockedUi, refreshing, shielded, status]);
}
