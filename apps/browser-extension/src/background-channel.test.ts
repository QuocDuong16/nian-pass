import { BackgroundChannelRegistry } from "./background-channel";
import { CONTENT_PORT_NAME } from "./runtime-port";
import { MockBrowserApi } from "./test/mock-browser";
import { MockRuntimePort } from "./test/mock-port";

const nonceA = "a".repeat(32);
const nonceB = "b".repeat(32);
const validSender = {
  id: "nian-pass-test",
  frameId: 0,
  url: "https://example.com/login?ignored=yes",
  tab: { id: 7, url: "https://untrusted-fallback.invalid/" },
};

function hello(documentNonce = nonceA): unknown {
  return { protocolVersion: 1, type: "documentHello", documentNonce };
}

async function acceptedRegistry(): Promise<{
  registry: BackgroundChannelRegistry;
  port: MockRuntimePort;
}> {
  const api = new MockBrowserApi();
  api.origins = ["https://example.com/*"];
  const registry = new BackgroundChannelRegistry(api);
  const port = new MockRuntimePort(CONTENT_PORT_NAME, validSender);
  registry.accept(port);
  port.emitMessage(hello());
  await vi.waitFor(() => {
    expect(registry.authorityFor(7, 0, nonceA)).not.toBeNull();
  });
  return { registry, port };
}

test("accepts only a permitted top-frame content sender and exact hello", async () => {
  const { registry, port } = await acceptedRegistry();
  expect(registry.authorityFor(7, 0, nonceA)).toMatchObject({
    tabId: 7,
    frameId: 0,
    origin: "https://example.com",
    documentNonce: nonceA,
    port,
  });
});

test.each([
  [
    "popup extension page",
    { id: "nian-pass-test", url: "moz-extension://id/popup.html" },
  ],
  ["wrong extension", { ...validSender, id: "other-extension" }],
  ["non-top frame", { ...validSender, frameId: 1 }],
  ["unsupported URL", { ...validSender, url: "about:config" }],
])("rejects %s Port authority", async (_name, sender) => {
  const api = new MockBrowserApi();
  api.origins = ["https://example.com/*"];
  const registry = new BackgroundChannelRegistry(api);
  const port = new MockRuntimePort(CONTENT_PORT_NAME, sender);
  registry.accept(port);
  expect(port.disconnected).toBe(true);
  expect(registry.authorityFor(7, 0, nonceA)).toBeNull();
});

test("rejects a sender without current permission", async () => {
  const registry = new BackgroundChannelRegistry(new MockBrowserApi());
  const port = new MockRuntimePort(CONTENT_PORT_NAME, validSender);
  registry.accept(port);
  port.emitMessage(hello());
  await vi.waitFor(() => {
    expect(port.disconnected).toBe(true);
  });
  expect(registry.authorityFor(7, 0, nonceA)).toBeNull();
});

test.each([
  { protocolVersion: 2, type: "documentHello", documentNonce: nonceA },
  { protocolVersion: 1, type: "documentHello", documentNonce: "bad" },
  {
    protocolVersion: 1,
    type: "documentHello",
    documentNonce: nonceA,
    origin: "https://claimed.invalid",
  },
])("rejects invalid initial protocol message %#", async (message) => {
  const api = new MockBrowserApi();
  api.origins = ["https://example.com/*"];
  const registry = new BackgroundChannelRegistry(api);
  const port = new MockRuntimePort(CONTENT_PORT_NAME, validSender);
  registry.accept(port);
  port.emitMessage(message);
  await vi.waitFor(() => {
    expect(port.disconnected).toBe(true);
  });
});

test("replaces a stale document Port for the same tab and frame", async () => {
  const { registry, port: portA } = await acceptedRegistry();
  const portB = new MockRuntimePort(CONTENT_PORT_NAME, validSender);
  registry.accept(portB);
  portB.emitMessage(hello(nonceB));
  await vi.waitFor(() => {
    expect(registry.authorityFor(7, 0, nonceB)?.port).toBe(portB);
  });
  expect(portA.disconnected).toBe(true);
  expect(registry.authorityFor(7, 0, nonceA)).toBeNull();
});

test("disconnect and tab clearing remove ephemeral document authority", async () => {
  const { registry, port } = await acceptedRegistry();
  port.disconnect();
  expect(registry.authorityFor(7, 0, nonceA)).toBeNull();

  const second = new MockRuntimePort(CONTENT_PORT_NAME, validSender);
  registry.accept(second);
  second.emitMessage(hello(nonceB));
  await vi.waitFor(() => {
    expect(registry.authorityFor(7, 0, nonceB)).not.toBeNull();
  });
  registry.clearTab(7);
  expect(second.disconnected).toBe(true);
  expect(registry.authorityFor(7, 0, nonceB)).toBeNull();
});
