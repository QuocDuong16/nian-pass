import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopWindowLifecycle } from "../../lib/window-lifecycle";

export const AUTO_LOCK_OPTIONS = [
  { label: "1 minute", timeoutMs: 60_000 },
  { label: "5 minutes", timeoutMs: 5 * 60_000 },
  { label: "15 minutes", timeoutMs: 15 * 60_000 },
  { label: "30 minutes", timeoutMs: 30 * 60_000 },
  { label: "Never", timeoutMs: null },
] as const;

export const DEFAULT_AUTO_LOCK_MS = 5 * 60_000;

interface IdleSecurityOptions {
  unlocked: boolean;
  timeoutMs: number | null;
  blocked: boolean;
  paused: boolean;
  windowLifecycle: DesktopWindowLifecycle | null;
  onExpired: () => void;
}

export function useIdleSecurity({
  unlocked,
  timeoutMs,
  blocked,
  paused,
  windowLifecycle,
  onExpired,
}: IdleSecurityOptions) {
  const [backgrounded, setBackgrounded] = useState(
    () => windowLifecycle?.isFocused !== undefined,
  );
  const [privacyVersion, setPrivacyVersion] = useState(0);
  const [expiryPending, setExpiryPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityAt = useRef(0);
  const handled = useRef(false);
  const options = useRef({ unlocked, timeoutMs, blocked, paused, onExpired });

  useEffect(() => {
    options.current = { unlocked, timeoutMs, blocked, paused, onExpired };
  }, [blocked, onExpired, paused, timeoutMs, unlocked]);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const reconcile = useCallback(
    function reconcileIdle() {
      clearTimer();
      const current = options.current;
      if (
        !current.unlocked ||
        current.timeoutMs === null ||
        current.paused ||
        handled.current
      ) {
        return;
      }
      const remaining =
        current.timeoutMs - (Date.now() - lastActivityAt.current);
      if (remaining > 0) {
        timer.current = setTimeout(reconcileIdle, remaining);
        return;
      }
      if (current.blocked) {
        setExpiryPending(true);
        return;
      }
      handled.current = true;
      setExpiryPending(false);
      current.onExpired();
    },
    [clearTimer],
  );

  const recordActivity = useCallback(() => {
    lastActivityAt.current = Date.now();
    handled.current = false;
    setExpiryPending(false);
    reconcile();
  }, [reconcile]);

  useEffect(() => {
    if (!unlocked) {
      clearTimer();
      handled.current = false;
      return;
    }
    recordActivity();
  }, [clearTimer, recordActivity, timeoutMs, unlocked]);

  useEffect(() => {
    if (!unlocked || paused) {
      clearTimer();
      return;
    }
    reconcile();
  }, [blocked, clearTimer, paused, reconcile, unlocked]);

  useEffect(() => {
    if (!unlocked) return;
    const activity = () => {
      if (!options.current.paused) recordActivity();
    };
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    events.forEach((event) => {
      window.addEventListener(event, activity);
    });
    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, activity);
      });
    };
  }, [recordActivity, unlocked]);

  useEffect(() => {
    if (windowLifecycle?.onFocusChanged === undefined) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    let focusVersion = 0;
    const applyFocus = (focused: boolean) => {
      if (!active) return;
      focusVersion += 1;
      const current = options.current;
      if (!focused) {
        setBackgrounded(true);
        if (current.unlocked) {
          setPrivacyVersion((value) => value + 1);
        }
        return;
      }
      setBackgrounded(false);
      if (!current.unlocked) return;
      const expired =
        current.timeoutMs !== null &&
        Date.now() - lastActivityAt.current >= current.timeoutMs;
      if (expired) reconcile();
      else if (!current.paused) recordActivity();
    };
    void windowLifecycle.onFocusChanged(applyFocus).then((stop) => {
      if (!active) {
        stop();
        return;
      }
      unlisten = stop;
      if (windowLifecycle.isFocused === undefined) return;
      const versionBeforeQuery = focusVersion;
      void windowLifecycle.isFocused().then((focused) => {
        if (active && focusVersion === versionBeforeQuery) applyFocus(focused);
      });
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [reconcile, recordActivity, windowLifecycle]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    backgrounded,
    expiryPending,
    privacyVersion,
    recordActivity,
  };
}
