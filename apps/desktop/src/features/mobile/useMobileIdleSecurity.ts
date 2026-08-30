import { useCallback, useEffect, useRef } from "react";

import type { MobileSecurityResumeDto } from "../../types/mobile";

export const MOBILE_AUTO_LOCK_OPTIONS = [
  { label: "1 minute", timeoutMs: 60_000 },
  { label: "5 minutes", timeoutMs: 5 * 60_000 },
  { label: "15 minutes", timeoutMs: 15 * 60_000 },
  { label: "30 minutes", timeoutMs: 30 * 60_000 },
  { label: "Never", timeoutMs: null },
] as const;

export const DEFAULT_MOBILE_AUTO_LOCK_MS = 5 * 60_000;

export function mobileElapsedExpired(
  lastActivityElapsedMs: number,
  currentElapsedMs: number,
  timeoutMs: number | null,
): boolean {
  return (
    timeoutMs !== null && currentElapsedMs - lastActivityElapsedMs >= timeoutMs
  );
}

interface Options {
  enabled: boolean;
  timeoutMs: number | null;
  paused: boolean;
  shielded: boolean;
  status: MobileSecurityResumeDto | null;
  onExpired: () => void;
}

export function useMobileIdleSecurity(options: Options) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityElapsedMs = useRef<number | null>(null);
  const observed = useRef<{ nativeMs: number; performanceMs: number } | null>(
    null,
  );
  const handled = useRef(false);
  const current = useRef(options);
  const reconcileRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    current.current = options;
  }, [options]);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const estimatedElapsed = useCallback(() => {
    const base = observed.current;
    if (base === null) return performance.now();
    return base.nativeMs + Math.max(0, performance.now() - base.performanceMs);
  }, []);

  const reconcile = useCallback(() => {
    clearTimer();
    const value = current.current;
    const last = lastActivityElapsedMs.current;
    if (
      !value.enabled ||
      value.timeoutMs === null ||
      value.paused ||
      value.shielded ||
      last === null ||
      handled.current
    ) {
      return;
    }
    const elapsed = estimatedElapsed();
    const remaining = value.timeoutMs - (elapsed - last);
    if (remaining > 0) {
      timer.current = setTimeout(() => {
        reconcileRef.current();
      }, remaining);
      return;
    }
    handled.current = true;
    value.onExpired();
  }, [clearTimer, estimatedElapsed]);

  useEffect(() => {
    reconcileRef.current = reconcile;
  }, [reconcile]);

  const recordActivity = useCallback(() => {
    lastActivityElapsedMs.current = estimatedElapsed();
    handled.current = false;
    reconcile();
  }, [estimatedElapsed, reconcile]);

  useEffect(() => {
    const status = options.status;
    if (status === null) return;
    observed.current = {
      nativeMs: status.elapsedRealtimeMs,
      performanceMs: performance.now(),
    };
    if (options.enabled && lastActivityElapsedMs.current === null) {
      lastActivityElapsedMs.current = status.elapsedRealtimeMs;
    }
    reconcile();
  }, [options.enabled, options.status, reconcile]);

  useEffect(() => {
    if (!options.enabled) {
      clearTimer();
      lastActivityElapsedMs.current = null;
      handled.current = false;
      return;
    }
    reconcile();
  }, [
    clearTimer,
    options.enabled,
    options.paused,
    options.shielded,
    options.timeoutMs,
    reconcile,
  ]);

  useEffect(() => {
    if (!options.enabled) return;
    const activity = () => {
      const value = current.current;
      if (!value.paused && !value.shielded) recordActivity();
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((event) => {
      window.addEventListener(event, activity);
    });
    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, activity);
      });
    };
  }, [options.enabled, recordActivity]);

  useEffect(() => clearTimer, [clearTimer]);

  return { recordActivity };
}
