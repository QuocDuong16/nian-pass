import {
  BackgroundAuthority,
  type MessageSender,
} from "./background-authority";
import { PROTOCOL_VERSION } from "./protocol";
import { MockBrowserApi } from "./test/mock-browser";

const popupSender: MessageSender = {
  id: "nian-pass-test",
  url: "chrome-extension://nian-pass-test/popup.html",
};
const pageSender: MessageSender = {
  id: "nian-pass-test",
  url: "https://example.com/login",
  frameId: 0,
  tab: { id: 7, url: "https://example.com/login" },
};
const pageState = (nonce: string, hasLoginForm = true) => ({
  protocolVersion: PROTOCOL_VERSION,
  type: "pageStateChanged" as const,
  documentNonce: nonce,
  hasLoginForm,
  passwordFieldCount: hasLoginForm ? 1 : 0,
  usernameCandidateCount: hasLoginForm ? 1 : 0,
  formCount: hasLoginForm ? 1 : 0,
  fillTarget: hasLoginForm
    ? {
        usernameFieldHandle: "c".repeat(32),
        passwordFieldHandle: "d".repeat(32),
      }
    : null,
});

describe("background authority", () => {
  test("derives active site status and exact permission pattern", async () => {
    const api = new MockBrowserApi();
    const authority = new BackgroundAuthority(api);
    const disabled = await authority.handleMessage(
      { protocolVersion: 1, type: "getSiteStatus" },
      popupSender,
    );
    expect(disabled).toMatchObject({
      permission: "disabled",
      site: {
        host: "example.com",
        origin: "https://example.com",
        permissionPattern: "https://example.com/*",
      },
    });
    expect(
      await authority.handleMessage(
        { protocolVersion: 1, type: "enableSite" },
        popupSender,
      ),
    ).toBeUndefined();
    expect(api.origins).toEqual([]);
  });

  test("rejects content messages without browser-owned authority", async () => {
    const api = new MockBrowserApi();
    api.origins = ["https://example.com/*"];
    const authority = new BackgroundAuthority(api);
    const valid = pageState("a".repeat(32));
    const cases: MessageSender[] = [
      {},
      { ...pageSender, id: "another-extension" },
      { ...pageSender, frameId: 2 },
      {
        ...pageSender,
        url: "chrome://settings",
        tab: { id: 7, url: "chrome://settings" },
      },
    ];
    for (const sender of cases) {
      expect(await authority.handleMessage(valid, sender)).toBeUndefined();
    }
    api.origins = [];
    expect(await authority.handleMessage(valid, pageSender)).toBeUndefined();
    expect(
      await authority.handleMessage(
        { ...valid, protocolVersion: 2 },
        pageSender,
      ),
    ).toBeUndefined();
    expect(
      await authority.handleMessage({ ...valid, extra: true }, pageSender),
    ).toBeUndefined();
  });

  test("replaces ephemeral status for a new document nonce and loses it safely", async () => {
    const api = new MockBrowserApi();
    api.origins = ["https://example.com/*"];
    const authority = new BackgroundAuthority(api);
    await authority.handleMessage(pageState("a".repeat(32), true), pageSender);
    expect(
      await authority.handleMessage(
        { protocolVersion: 1, type: "getSiteStatus" },
        popupSender,
      ),
    ).toMatchObject({ detection: "detected" });
    await authority.handleMessage(pageState("b".repeat(32), false), pageSender);
    expect(
      await authority.handleMessage(
        { protocolVersion: 1, type: "getSiteStatus" },
        popupSender,
      ),
    ).toMatchObject({ detection: "notDetected" });
    authority.clearEphemeralState();
    expect(
      await authority.handleMessage(
        { protocolVersion: 1, type: "getSiteStatus" },
        popupSender,
      ),
    ).toMatchObject({ detection: "waiting" });
    api.origins = [];
    authority.clearEphemeralState();
    expect(
      await authority.handleMessage(
        { protocolVersion: 1, type: "getSiteStatus" },
        popupSender,
      ),
    ).toMatchObject({ permission: "disabled", detection: "unavailable" });
  });

  test("rejects unsupported tabs and non-popup extension senders", async () => {
    const api = new MockBrowserApi();
    api.activeTab = { id: 9, url: "about:config" };
    const authority = new BackgroundAuthority(api);
    expect(
      await authority.handleMessage(
        { protocolVersion: 1, type: "getSiteStatus" },
        popupSender,
      ),
    ).toMatchObject({ permission: "unsupported" });
    expect(
      await authority.handleMessage(
        { protocolVersion: 1, type: "enableSite" },
        { ...popupSender, url: "chrome-extension://nian-pass-test/other.html" },
      ),
    ).toBeUndefined();
  });
});
