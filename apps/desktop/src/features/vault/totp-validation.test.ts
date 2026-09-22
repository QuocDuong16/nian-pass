import { expect, test } from "vitest";

import { validTotpUri } from "./totp-validation";

test("TOTP URI validation accepts bounded TOTP parameters and rejects unsafe shapes", () => {
  expect(
    validTotpUri(
      "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&period=30&digits=6&algorithm=SHA256",
    ),
  ).toBe(true);
  for (const value of [
    "",
    "https://totp/Example?secret=value",
    "otpauth://hotp/Example?secret=value",
    "otpauth://totp/Example",
    "otpauth://totp/Example?secret=value&period=0",
    "otpauth://totp/Example?secret=value&digits=5",
    "otpauth://totp/Example?secret=value&algorithm=MD5",
  ]) {
    expect(validTotpUri(value)).toBe(false);
  }
});
