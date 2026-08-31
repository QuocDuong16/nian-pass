import { CONTENT_SCRIPT_ID, reconcileContentScript } from "./permissions";
import { MockBrowserApi } from "./test/mock-browser";

describe("dynamic content script reconciliation", () => {
  test("install with no permissions leaves no registration", async () => {
    const api = new MockBrowserApi();
    await reconcileContentScript(api);
    expect(api.registered).toEqual([]);
  });

  test("converges across enable, duplicate enable, second site, and disable", async () => {
    const api = new MockBrowserApi();
    api.origins = ["https://b.example/*"];
    await reconcileContentScript(api);
    expect(api.registered[0]?.matches).toEqual(["https://b.example/*"]);
    await reconcileContentScript(api);
    expect(api.registerCalls).toBe(1);

    api.origins.push("https://a.example/*", "https://b.example/*");
    await reconcileContentScript(api);
    expect(api.registered).toEqual([
      expect.objectContaining({
        id: CONTENT_SCRIPT_ID,
        matches: ["https://a.example/*", "https://b.example/*"],
        allFrames: false,
      }),
    ]);

    api.origins = ["https://a.example/*"];
    await reconcileContentScript(api);
    expect(api.registered[0]?.matches).toEqual(["https://a.example/*"]);
  });

  test("repairs drift and browser restart state", async () => {
    const api = new MockBrowserApi();
    api.origins = ["https://example.com/*"];
    api.registered = [
      {
        id: CONTENT_SCRIPT_ID,
        matches: ["https://stale.example/*"],
        js: ["old.js"],
      },
    ];
    await reconcileContentScript(api);
    expect(api.unregisterCalls).toBe(1);
    expect(api.registered[0]).toMatchObject({
      matches: ["https://example.com/*"],
      js: ["content.js"],
      runAt: "document_idle",
    });
  });

  test("serializes duplicate lifecycle events without duplicate registrations", async () => {
    const api = new MockBrowserApi();
    api.origins = ["https://example.com/*"];
    await Promise.all([
      reconcileContentScript(api),
      reconcileContentScript(api),
      reconcileContentScript(api),
    ]);
    expect(api.registerCalls).toBe(1);
    expect(api.registered).toHaveLength(1);
  });

  test("external permission removal unregisters the script", async () => {
    const api = new MockBrowserApi();
    api.registered = [
      { id: CONTENT_SCRIPT_ID, matches: ["https://example.com/*"] },
    ];
    await reconcileContentScript(api);
    expect(api.registered).toEqual([]);
  });
});
