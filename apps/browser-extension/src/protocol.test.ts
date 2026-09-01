import {
  PROTOCOL_VERSION,
  parseApplyCredential,
  parseDocumentHello,
  parsePageStateChanged,
} from "./protocol";
import { parsePopupMessage, parseSiteStatus } from "./popup-protocol";

const pageState = {
  protocolVersion: PROTOCOL_VERSION,
  type: "pageStateChanged",
  documentNonce: "a".repeat(32),
  hasLoginForm: true,
  passwordFieldCount: 1,
  usernameCandidateCount: 1,
  formCount: 1,
  fillTarget: {
    usernameFieldHandle: "e".repeat(32),
    passwordFieldHandle: "f".repeat(32),
  },
};

describe("message validation", () => {
  test("accepts exact known shapes", () => {
    expect(parsePageStateChanged(pageState)).toEqual(pageState);
    expect(
      parsePopupMessage({ protocolVersion: 1, type: "getSiteStatus" }),
    ).not.toBeNull();
    expect(
      parseDocumentHello({
        protocolVersion: 1,
        type: "documentHello",
        documentNonce: "c".repeat(32),
      }),
    ).not.toBeNull();
    expect(
      parseSiteStatus({
        protocolVersion: 1,
        type: "siteStatus",
        site: {
          host: "example.com",
          origin: "https://example.com",
          permissionPattern: "https://example.com/*",
        },
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
      passwordFieldHandle: "d".repeat(32),
      username: "synthetic-user",
      password: "synthetic-password",
    };
    expect(parseApplyCredential(command)).toEqual(command);
    expect(parseApplyCredential({ ...command, arbitrary: true })).toBeNull();
    expect(
      parseApplyCredential({ ...command, type: "fillAnything" }),
    ).toBeNull();
    expect(
      parseApplyCredential({ ...command, passwordFieldHandle: "selector" }),
    ).toBeNull();
    expect(
      parseApplyCredential({ ...command, password: "x".repeat(65_537) }),
    ).toBeNull();
  });

  test.each([
    {
      protocolVersion: 2,
      type: "documentHello",
      documentNonce: "a".repeat(32),
    },
    { protocolVersion: 1, type: "documentHello", documentNonce: "bad" },
    {
      protocolVersion: 1,
      type: "documentHello",
      documentNonce: "a".repeat(32),
      extra: true,
    },
  ])("rejects invalid document hello %#", (message) => {
    expect(parseDocumentHello(message)).toBeNull();
  });
});
