import { useEffect, useState } from "react";

import type { TotpCodeDto } from "../../types/desktop";

export function useTotpCode() {
  const [code, setCode] = useState<TotpCodeDto | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (code === null) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          setCode(null);
          window.clearInterval(timer);
          return 0;
        }
        return value - 1;
      });
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [code]);

  const show = (value: TotpCodeDto) => {
    setCode(value);
    setRemaining(value.validForSeconds);
  };

  const clear = () => {
    setCode(null);
    setRemaining(0);
  };

  return { code, remaining, show, clear };
}
