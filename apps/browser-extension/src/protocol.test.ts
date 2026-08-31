import {
  PROTOCOL_VERSION,
  parseActionResult,
  parseApplyCredential,
  parsePageStateChanged,
  parsePopupMessage,
  parseSiteStatus,
} from "./protocol";

const pageState = {
  protocolVersion: PROTOCOL_VERSION,
  type: "pageStateChanged",
  documentNonce: "a".repeat(32),
  hasLoginForm: true,
  passwordFieldCount: 1,
  usernameCandidateCount: 1,
  formCount: 1,
};

describe("message validation", () => {
  test("accepts exact known shapes", () => {
    expect(parsePageStateChanged(pageState)).toEqual(pageState);
    expect(
      parsePopupMessage({ protocolVersion: 1, type: "getSiteStatus" }),
    ).not.toBeNull();
    expect(
      parseActionResult({ protocolVersion: 1, type: "actionResult", ok: true }),
    ).not.toBeNull();
    expect(
      parseSiteStatus({
        protocolVersion: 1,
        type: "siteStatus",
        site: { host: "example.com", origin: "https://example.com" },
        permission: "enabled",
        detection: "waiting",
      }),
    ).not.toBeNull();
  });

  test.each([
    { ...pageState, type: "unknown" },
    { ...pageState, extra: true },
    { ...pageState, protocolVersion: 2 },
    { ...pageState, protocolVersion: undefined },
    { ...pageState, passwordFieldCount: -1 },
    { ...pageState, documentNonce: "stale" },
  ])("rejects invalid page state %#", (message) => {
    expect(parsePageStateChanged(message)).toBeNull();
  });

  test("validates the narrow fill command", () => {
    const command = {
      protocolVersion: 1,
      type: "applyCredential",
      documentNonce: "b".repeat(32),
      usernameFieldHandle: null,
      passwordFieldHandle: "opaque",
      username: "synthetic-user",
      password: "synthetic-password",
    };
    expect(parseApplyCredential(command)).toEqual(command);
    expect(parseApplyCredential({ ...command, arbitrary: true })).toBeNull();
    expect(
      parseApplyCredential({ ...command, type: "fillAnything" }),
    ).toBeNull();
  });
});
