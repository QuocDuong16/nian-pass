import { useCallback, useEffect, useRef, useState } from "react";

export interface SecretDraft {
  value: string | null;
  loading: boolean;
  failed: boolean;
  load: (reader: () => Promise<string>) => Promise<void>;
  set: (value: string) => void;
  clear: () => void;
}

export function useSecretDraft(): SecretDraft {
  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  const clear = useCallback(() => {
    generation.current += 1;
    setValue(null);
    setLoading(false);
    setFailed(false);
  }, []);

  useEffect(() => clear, [clear]);

  const load = useCallback(async (reader: () => Promise<string>) => {
    generation.current += 1;
    const current = generation.current;
    setValue(null);
    setFailed(false);
    setLoading(true);
    try {
      const next = await reader();
      if (generation.current === current) {
        setValue(next);
        setLoading(false);
      }
    } catch {
      if (generation.current === current) {
        setLoading(false);
        setFailed(true);
      }
    }
  }, []);

  return { value, loading, failed, load, set: setValue, clear };
}
