import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { useTotpCode } from "./useTotpCode";

afterEach(() => {
  vi.useRealTimers();
});

test("revealed TOTP counts down and clears itself at expiry", () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useTotpCode());

  act(() => {
    result.current.show({
      code: "123456",
      validForSeconds: 2,
      periodSeconds: 30,
    });
  });
  expect(result.current.code?.code).toBe("123456");
  expect(result.current.remaining).toBe(2);

  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(result.current.remaining).toBe(1);

  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(result.current.code).toBeNull();
  expect(result.current.remaining).toBe(0);
});
