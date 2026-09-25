import { describe, expect, test } from "vitest";

import { parseRuntimeInfo } from "./runtime-validation";

describe("runtime info validation", () => {
  test("accepts the desktop contract with its backend persistence capability", () => {
    expect(
      parseRuntimeInfo({
        platform: "desktop",
        version: "0.1.0",
        commit: "unknown",
        ordinarySaveSupported: false,
      }),
    ).toEqual({
      platform: "desktop",
      version: "0.1.0",
      commit: "unknown",
      ordinarySaveSupported: false,
    });
  });

  test.each(["android", "ios"] as const)(
    "accepts the exact %s runtime contract without desktop capabilities",
    (platform) => {
      expect(
        parseRuntimeInfo({ platform, version: "0.1.0", commit: "unknown" }),
      ).toEqual({ platform, version: "0.1.0", commit: "unknown" });
    },
  );

  test.each([
    {},
    { platform: "linux" },
    { platform: "android", version: "14", commit: "unknown" },
    { platform: "desktop", version: "0.1.0", commit: "unknown" },
    {
      platform: "desktop",
      version: "0.1.0",
      commit: "unknown",
      ordinarySaveSupported: "false",
    },
    { platform: "ios", deviceId: "forbidden" },
    {
      platform: "ios",
      version: "0.1.0",
      commit: "unknown",
      ordinarySaveSupported: true,
    },
    null,
    [],
  ])("rejects missing, unknown, or extra runtime metadata", (value) => {
    expect(() => parseRuntimeInfo(value)).toThrow(
      "Nian Pass received invalid runtime information",
    );
  });
});
