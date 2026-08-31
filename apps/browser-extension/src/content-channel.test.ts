import { ContentChannel } from "./content-channel";
import { FieldRegistry } from "./content/field-registry";
import { BackgroundChannelRegistry } from "./background-channel";
import { CONTENT_PORT_NAME } from "./runtime-port";
import { MockBrowserApi } from "./test/mock-browser";
import { MockRuntimePort } from "./test/mock-port";

test("opens the fixed background channel and sends only document identity", () => {
  const port = new MockRuntimePort(CONTENT_PORT_NAME);
  const connect = vi.fn(() => port);
  const apply = vi.fn();
  new ContentChannel({
    documentNonce: "a".repeat(32),
    connect,
    apply,
    isCurrentDocument: () => true,
  }).start();
  expect(connect).toHaveBeenCalledWith(CONTENT_PORT_NAME);
  expect(port.messages).toEqual([
    {
      protocolVersion: 1,
      type: "documentHello",
      documentNonce: "a".repeat(32),
    },
  ]);
  port.emitMessage({ protocolVersion: 1, type: "unknown" });
  expect(apply).not.toHaveBeenCalled();
});

test("a validated background Port can deliver a synthetic exact-document fill", async () => {
  document.body.innerHTML =
    '<form><input id="user" type="email"><input id="pass" type="password"></form>';
  const fields = new FieldRegistry(document, "a".repeat(32));
  const username = document.querySelector<HTMLInputElement>("#user");
  const password = document.querySelector<HTMLInputElement>("#pass");
  if (username === null || password === null)
    throw new Error("Missing fixture");
  const api = new MockBrowserApi();
  api.origins = ["https://example.com/*"];
  const registry = new BackgroundChannelRegistry(api);
  const backgroundPort = new MockRuntimePort(CONTENT_PORT_NAME, {
    id: "nian-pass-test",
    frameId: 0,
    url: "https://example.com/login",
    tab: { id: 7 },
  });
  const contentPort = new MockRuntimePort(CONTENT_PORT_NAME);
  contentPort.link(backgroundPort);
  registry.accept(backgroundPort);
  new ContentChannel({
    documentNonce: fields.documentNonce,
    connect: () => contentPort,
    apply: (command) => {
      fields.apply(command);
    },
    isCurrentDocument: () => true,
  }).start();
  await vi.waitFor(() => {
    expect(registry.authorityFor(7, 0, fields.documentNonce)).not.toBeNull();
  });
  registry.authorityFor(7, 0, fields.documentNonce)?.port.postMessage({
    protocolVersion: 1,
    type: "applyCredential",
    documentNonce: fields.documentNonce,
    usernameFieldHandle: fields.handleFor(username),
    passwordFieldHandle: fields.handleFor(password),
    username: "synthetic-user",
    password: "synthetic-password",
  });
  expect(username.value).toBe("synthetic-user");
  expect(password.value).toBe("synthetic-password");
});

test("reconnects once while the same document remains active", async () => {
  const firstPort = new MockRuntimePort(CONTENT_PORT_NAME);
  const secondPort = new MockRuntimePort(CONTENT_PORT_NAME);
  const ports = [firstPort, secondPort];
  const connect = vi.fn(
    () => ports.shift() ?? new MockRuntimePort("unexpected"),
  );
  new ContentChannel({
    documentNonce: "a".repeat(32),
    connect,
    apply: () => undefined,
    isCurrentDocument: () => true,
  }).start();
  firstPort.disconnect();
  await Promise.resolve();
  expect(connect).toHaveBeenCalledTimes(2);
  secondPort.disconnect();
  await Promise.resolve();
  expect(connect).toHaveBeenCalledTimes(2);
});
