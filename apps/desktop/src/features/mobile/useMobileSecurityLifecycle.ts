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

  const refresh = useCallback(async () => {
    if (!enabled) return null;
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
    setShielded(true);
    setRefreshing(true);
    setBoundaryPending(true);
    onSecurityTransition();
    void refresh();
  }, [enabled, onSecurityTransition, refresh]);

  const acknowledge = useCallback(
    async (generation: number) => {
      if (document.hidden) return false;
      const current = statusRef.current;
      if (current?.generation !== generation) return false;
      if (!current.foreground || current.screenState !== "active") {
        return false;
      }
      try {
        const result = await api.acknowledgeSafeUi(generation);
        if (
          result.acknowledged &&
          statusRef.current?.generation === generation
        ) {
          setShielded(false);
          setBoundaryPending(false);
          return true;
        }
      } catch {
        // The native curtain remains authoritative on acknowledgement failure.
      }
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
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);
    return () => {
      active = false;
      requestVersion.current += 1;
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pageshow", reconcile);
    };
  }, [enabled, invalidate, onSecurityTransition, refresh]);

  useEffect(() => {
    if (!enabled || !shielded || document.hidden || refreshing) return;
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
