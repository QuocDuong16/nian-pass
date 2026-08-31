import type browser from "webextension-polyfill";
import { vi } from "vitest";

import { createBrowserApi } from "./browser-api";

function extensionMock(): typeof browser {
  return {
    permissions: {
      getAll: vi.fn().mockResolvedValue({ origins: ["https://example.com/*"] }),
      contains: vi.fn().mockResolvedValue(true),
    },
    scripting: {
      getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
      unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
      registerContentScripts: vi.fn().mockResolvedValue(undefined),
    },
    tabs: {
      query: vi
        .fn()
        .mockResolvedValue([{ id: 5, url: "https://example.com/" }]),
    },
    runtime: {
      id: "test-extension-id",
      getURL: vi.fn(
        (path: string) => `moz-extension://test-extension-id/${path}`,
      ),
    },
  } as unknown as typeof browser;
}

describe.each(["Chromium", "Firefox"])("%s Promise API adapter", () => {
  test("normalizes browser calls behind one policy-free interface", async () => {
    const extension = extensionMock();
    const api = createBrowserApi(extension);
    expect(await api.getAllPermissions()).toEqual({
      origins: ["https://example.com/*"],
    });
    expect(await api.containsOrigin("https://example.com/*")).toBe(true);
    expect(await api.getRegisteredScripts("script-id")).toEqual([]);
    await api.registerScript({
      id: "script-id",
      matches: ["https://example.com/*"],
    });
    await api.unregisterScripts("script-id");
    expect(await api.queryActiveTab()).toMatchObject({ id: 5 });
    expect(api.extensionId()).toBe("test-extension-id");
    expect(api.popupUrl()).toBe("moz-extension://test-extension-id/popup.html");
  });
});
