import { vi } from "vitest";

import { CONTENT_PORT_NAME } from "./runtime-port";
import { MockRuntimePort } from "./test/mock-port";

const mocks = vi.hoisted(() => ({
  runtimeMessage: vi.fn(),
  runtimeConnect: vi.fn(),
  installed: vi.fn(),
  startup: vi.fn(),
  permissionAdded: vi.fn(),
  permissionRemoved: vi.fn(),
  tabRemoved: vi.fn(),
  tabUpdated: vi.fn(),
  getAllPermissions: vi.fn().mockResolvedValue({ origins: [] }),
  getRegisteredScripts: vi.fn().mockResolvedValue([]),
  containsOrigin: vi.fn().mockResolvedValue(false),
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      onMessage: { addListener: mocks.runtimeMessage },
      onConnect: { addListener: mocks.runtimeConnect },
      onInstalled: { addListener: mocks.installed },
      onStartup: { addListener: mocks.startup },
    },
    permissions: {
      onAdded: { addListener: mocks.permissionAdded },
      onRemoved: { addListener: mocks.permissionRemoved },
    },
    tabs: {
      onRemoved: { addListener: mocks.tabRemoved },
      onUpdated: { addListener: mocks.tabUpdated },
    },
  },
}));

vi.mock("./browser-binding", () => ({
  browserApi: {
    getAllPermissions: mocks.getAllPermissions,
    getRegisteredScripts: mocks.getRegisteredScripts,
    containsOrigin: mocks.containsOrigin,
    unregisterScripts: vi.fn().mockResolvedValue(undefined),
    registerScript: vi.fn().mockResolvedValue(undefined),
    queryActiveTab: vi.fn().mockResolvedValue(null),
    extensionId: () => "test-id",
    popupUrl: () => "moz-extension://test-id/popup.html",
  },
}));

test("registers all background listeners synchronously and schedules lifecycle work", async () => {
  await import("./background");
  expect(mocks.runtimeMessage).toHaveBeenCalledOnce();
  expect(mocks.runtimeConnect).toHaveBeenCalledOnce();
  expect(mocks.installed).toHaveBeenCalledOnce();
  expect(mocks.startup).toHaveBeenCalledOnce();
  expect(mocks.permissionAdded).toHaveBeenCalledOnce();
  expect(mocks.permissionRemoved).toHaveBeenCalledOnce();
  expect(mocks.tabRemoved).toHaveBeenCalledOnce();
  expect(mocks.tabUpdated).toHaveBeenCalledOnce();

  const installed = mocks.installed.mock.calls[0]?.[0] as () => void;
  const removed = mocks.permissionRemoved.mock.calls[0]?.[0] as () => void;
  const tabRemoved = mocks.tabRemoved.mock.calls[0]?.[0] as (
    tabId: number,
  ) => void;
  const tabUpdated = mocks.tabUpdated.mock.calls[0]?.[0] as (
    tabId: number,
    change: { status?: string; url?: string },
  ) => void;
  const acceptPort = mocks.runtimeConnect.mock.calls[0]?.[0] as (
    port: MockRuntimePort,
  ) => void;
  mocks.containsOrigin.mockResolvedValue(true);
  const port = new MockRuntimePort(CONTENT_PORT_NAME, {
    id: "test-id",
    frameId: 0,
    url: "https://example.test/login",
    tab: { id: 3, url: "https://example.test/login" },
  });
  acceptPort(port);
  port.emitMessage({
    protocolVersion: 1,
    type: "documentHello",
    documentNonce: "a".repeat(32),
  });
  await Promise.resolve();
  installed();
  removed();
  tabRemoved(3);
  tabUpdated(3, { status: "loading" });
  tabUpdated(3, { url: "https://example.test/" });
  await vi.waitFor(() => {
    expect(mocks.getAllPermissions).toHaveBeenCalled();
  });
});
