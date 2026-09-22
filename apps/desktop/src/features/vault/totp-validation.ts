export function validTotpUri(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    const digits = Number(url.searchParams.get("digits") ?? "6");
    const period = Number(url.searchParams.get("period") ?? "30");
    const algorithm = url.searchParams.get("algorithm") ?? "SHA1";
    return (
      url.protocol === "otpauth:" &&
      url.hostname === "totp" &&
      (url.searchParams.get("secret")?.trim().length ?? 0) > 0 &&
      Number.isSafeInteger(digits) &&
      digits >= 6 &&
      digits <= 10 &&
      Number.isSafeInteger(period) &&
      period > 0 &&
      ["SHA1", "SHA256", "SHA512"].includes(algorithm)
    );
  } catch {
    return false;
  }
}
