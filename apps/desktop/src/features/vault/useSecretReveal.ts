import { useCallback, useEffect, useRef, useState } from "react";

import type { EntryId } from "../../types/desktop";

export const SECRET_REVEAL_MS = 15_000;

interface RevealValue {
  entryId: EntryId;
  value: string;
}

interface RevealMarker {
  entryId: EntryId;
  generation: number;
}

interface SecretRevealOptions {
  entryId: EntryId;
  disabled: boolean;
  load: (entryId: EntryId) => Promise<string>;
}

export interface SecretReveal {
  secret: string | null;
  loading: boolean;
  failed: boolean;
  reveal: () => Promise<void>;
  clear: () => void;
}

export function useSecretReveal({
  entryId,
  disabled,
  load,
}: SecretRevealOptions): SecretReveal {
  const [revealed, setRevealed] = useState<RevealValue | null>(null);
  const [loading, setLoading] = useState<RevealMarker | null>(null);
  const [failed, setFailed] = useState<RevealMarker | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    generation.current += 1;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setRevealed(null);
    setLoading(null);
    setFailed(null);
  }, []);

  useEffect(
    () => () => {
      generation.current += 1;
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const clearOnBlur = () => {
      clear();
    };
    const clearWhenHidden = () => {
      if (document.visibilityState === "hidden") clear();
    };
    window.addEventListener("blur", clearOnBlur);
    document.addEventListener("visibilitychange", clearWhenHidden);
    return () => {
      window.removeEventListener("blur", clearOnBlur);
      document.removeEventListener("visibilitychange", clearWhenHidden);
    };
  }, [clear]);

  const reveal = useCallback(async () => {
    if (disabled || loading?.entryId === entryId) return;
    generation.current += 1;
    const requestGeneration = generation.current;
    const marker = { entryId, generation: requestGeneration };
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setRevealed(null);
    setFailed(null);
    setLoading(marker);
    try {
      const value = await load(entryId);
      if (generation.current !== requestGeneration) {
        return;
      }
      setLoading(null);
      setRevealed({ entryId, value });
      timer.current = setTimeout(() => {
        if (generation.current === requestGeneration) clear();
      }, SECRET_REVEAL_MS);
    } catch {
      if (generation.current === requestGeneration) {
        setLoading(null);
        setFailed(marker);
      }
    }
  }, [disabled, entryId, load, loading, clear]);

  return {
    secret: !disabled && revealed?.entryId === entryId ? revealed.value : null,
    loading: !disabled && loading?.entryId === entryId,
    failed: !disabled && failed?.entryId === entryId,
    reveal,
    clear,
  };
}
