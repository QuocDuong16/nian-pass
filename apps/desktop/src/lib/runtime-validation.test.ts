import { describe, expect, test } from "vitest";

import { parseRuntimeInfo } from "./runtime-validation";

describe("runtime info validation", () => {
  test.each(["desktop", "android", "ios"] as const)(
    "accepts the exact %s platform contract",
    (platform) => {
      expect(parseRuntimeInfo({ platform })).toEqual({ platform });
    },
  );

  test.each([
    {},
    { platform: "linux" },
    { platform: "android", version: "14" },
    { platform: "ios", deviceId: "forbidden" },
    null,
    [],
  ])("rejects missing, unknown, or extra runtime metadata", (value) => {
    expect(() => parseRuntimeInfo(value)).toThrow(
      "Nian Pass received invalid runtime information",
    );
  });
});
