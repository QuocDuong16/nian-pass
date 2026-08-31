import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  portMessageListener: vi.fn(),
  portDisconnectListener: vi.fn(),
  connect: vi.fn(),
  postMessage: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

mocks.connect.mockReturnValue({
  name: "nian-pass-content-v1",
  onMessage: { addListener: mocks.portMessageListener },
  onDisconnect: { addListener: mocks.portDisconnectListener },
  postMessage: mocks.postMessage,
  disconnect: vi.fn(),
});

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      connect: mocks.connect,
      sendMessage: mocks.sendMessage,
    },
  },
}));

test("starts structural reporting and a document-bound background Port", async () => {
  vi.useFakeTimers();
  document.body.textContent = "";
  await import("./content");
  await vi.advanceTimersByTimeAsync(40);
  expect(mocks.sendMessage).toHaveBeenCalledOnce();
  expect(mocks.connect).toHaveBeenCalledWith({
    name: "nian-pass-content-v1",
  });
  expect(mocks.portMessageListener).toHaveBeenCalledOnce();
  expect(mocks.portDisconnectListener).toHaveBeenCalledOnce();
  const report = mocks.sendMessage.mock.calls[0]?.[0] as {
    documentNonce: string;
  };
  expect(mocks.postMessage).toHaveBeenCalledWith({
    protocolVersion: 1,
    type: "documentHello",
    documentNonce: report.documentNonce,
  });
  const receiveFromBackground = mocks.portMessageListener.mock
    .calls[0]?.[0] as (message: unknown) => void;
  receiveFromBackground({
    protocolVersion: 1,
    type: "applyCredential",
    documentNonce: report.documentNonce,
    usernameFieldHandle: null,
    passwordFieldHandle: "f".repeat(32),
    username: "synthetic-user",
    password: "synthetic-password",
  });
  const disconnect = mocks.portDisconnectListener.mock
    .calls[0]?.[0] as () => void;
  disconnect();
  await Promise.resolve();
  expect(mocks.connect).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
