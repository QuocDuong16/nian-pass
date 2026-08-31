import { useCallback, useEffect, useRef, useState } from "react";

import type { MobileApi, MobileSecurityResumeDto } from "../../types/mobile";

interface Options {
  api: MobileApi;
  enabled: boolean;
  onSecurityTransition: () => void;
}

export function useMobileSecurityLifecycle({
  api,
  enabled,
  onSecurityTransition,
}: Options) {
  const [status, setStatus] = useState<MobileSecurityResumeDto | null>(null);
  const [shielded, setShielded] = useState(enabled);
  const [refreshing, setRefreshing] = useState(enabled);
  const [boundaryPending, setBoundaryPending] = useState(false);
  const statusRef = useRef<MobileSecurityResumeDto | null>(null);
  const requestVersion = useRef(0);
  const acknowledgementVersion = useRef(0);
  const windowFocused = useRef(!document.hidden);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    acknowledgementVersion.current += 1;
    const request = requestVersion.current + 1;
    requestVersion.current = request;
    setRefreshing(true);
    try {
      const next = await api.securityResume();
      if (request !== requestVersion.current) return null;
      const current = statusRef.current;
      if (
        current?.generation !== undefined &&
        next.generation < current.generation
      )
        return null;
      statusRef.current = next;
      setStatus(next);
      if (!next.foreground || next.screenState !== "active") setShielded(true);
      return next;
    } catch {
      if (request === requestVersion.current) setShielded(true);
      return null;
    } finally {
      if (request === requestVersion.current) setRefreshing(false);
    }
  }, [api, enabled]);

  const invalidate = useCallback(() => {
    if (!enabled) return;
    acknowledgementVersion.current += 1;
    setShielded(true);
    setRefreshing(true);
    setBoundaryPending(true);
    onSecurityTransition();
    void refresh();
  }, [enabled, onSecurityTransition, refresh]);

  const acknowledge = useCallback(
    async (generation: number) => {
      const frontendLifecycleReady = () =>
        !document.hidden && windowFocused.current;
      if (!frontendLifecycleReady()) return false;
      const current = statusRef.current;
      if (current?.generation !== generation) return false;
      if (!current.foreground || current.screenState !== "active") {
        return false;
      }
      const acknowledgement = acknowledgementVersion.current + 1;
      acknowledgementVersion.current = acknowledgement;
      const refreshRequest = requestVersion.current;
      try {
        const result = await api.acknowledgeSafeUi(generation);
        const latest = statusRef.current;
        if (
          result.acknowledged &&
          acknowledgement === acknowledgementVersion.current &&
          refreshRequest === requestVersion.current &&
          frontendLifecycleReady() &&
          latest?.generation === generation &&
          latest.foreground &&
          latest.screenState === "active"
        ) {
          setShielded(false);
          setBoundaryPending(false);
          return true;
        }
      } catch {
        // The native curtain remains authoritative on acknowledgement failure.
      }
      if (acknowledgement !== acknowledgementVersion.current) return false;
      setShielded(true);
      void refresh();
      return false;
    },
    [api, refresh],
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      onSecurityTransition();
      void refresh();
    });
    const reconcile = () => {
      invalidate();
    };
    const visibilityChanged = () => {
      if (document.hidden) windowFocused.current = false;
      invalidate();
    };
    const blurred = () => {
      windowFocused.current = false;
      invalidate();
    };
    const focused = () => {
      windowFocused.current = true;
      invalidate();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("blur", blurred);
    window.addEventListener("focus", focused);
    window.addEventListener("pageshow", reconcile);
    return () => {
      active = false;
      requestVersion.current += 1;
      acknowledgementVersion.current += 1;
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("blur", blurred);
      window.removeEventListener("focus", focused);
      window.removeEventListener("pageshow", reconcile);
    };
  }, [enabled, invalidate, onSecurityTransition, refresh]);

  useEffect(() => {
    if (
      !enabled ||
      !shielded ||
      document.hidden ||
      !windowFocused.current ||
      refreshing
    )
      return;
    const timer = window.setTimeout(() => {
      void refresh();
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [enabled, refreshing, refresh, shielded, status]);

  return {
    status,
    shielded,
    refreshing,
    boundaryPending,
    acknowledge,
    refresh,
    invalidate,
  };
}
