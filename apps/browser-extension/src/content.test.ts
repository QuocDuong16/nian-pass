import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      id: "test-extension-id",
      onMessage: { addListener: mocks.addListener },
      sendMessage: mocks.sendMessage,
    },
  },
}));

test("starts structural reporting and rejects unbound fill messages", async () => {
  vi.useFakeTimers();
  document.body.textContent = "";
  await import("./content");
  await vi.advanceTimersByTimeAsync(40);
  expect(mocks.sendMessage).toHaveBeenCalledOnce();
  expect(mocks.addListener).toHaveBeenCalledOnce();
  const report = mocks.sendMessage.mock.calls[0]?.[0] as {
    documentNonce: string;
  };
  const listener = mocks.addListener.mock.calls[0]?.[0] as (
    message: unknown,
    sender: { id?: string; tab?: unknown },
  ) => unknown;
  expect(
    listener(
      { protocolVersion: 1, type: "unknown" },
      { id: "test-extension-id" },
    ),
  ).toBeUndefined();
  expect(listener({}, { id: "other" })).toBeUndefined();
  await expect(
    listener(
      {
        protocolVersion: 1,
        type: "applyCredential",
        documentNonce: report.documentNonce,
        usernameFieldHandle: null,
        passwordFieldHandle: "unknown",
        username: "synthetic-user",
        password: "synthetic-password",
      },
      { id: "test-extension-id" },
    ),
  ).resolves.toBe("unknownField");
  vi.useRealTimers();
});
