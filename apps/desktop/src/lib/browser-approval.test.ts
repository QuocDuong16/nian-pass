import { vi } from "vitest";
import { expect, test } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import { browserApprovalApi } from "./browser-approval";

test("approval event accepts only one exact opaque request ID", async () => {
  let listener: ((event: { payload: unknown }) => void) | undefined;
  mocks.listen.mockImplementation(
    (_name: string, next: (event: { payload: unknown }) => void) => {
      listener = next;
      return Promise.resolve(mocks.stop);
    },
  );
  const handler = vi.fn();
  const stop = await browserApprovalApi.subscribe(handler);
  expect(mocks.listen).toHaveBeenCalledWith(
    "browser-connection-request",
    expect.any(Function),
  );
  listener?.({ payload: { requestId: "a".repeat(32) } });
  listener?.({ payload: { requestId: "short" } });
  listener?.({ payload: { requestId: "b".repeat(32), vaultPath: "/secret" } });
  listener?.({ payload: null });
  expect(handler).toHaveBeenCalledOnce();
  expect(handler).toHaveBeenCalledWith("a".repeat(32));
  stop();
  expect(mocks.stop).toHaveBeenCalledOnce();
});

test("approval resolution invokes only the narrow command", async () => {
  await browserApprovalApi.resolve("c".repeat(32), true);
  expect(mocks.invoke).toHaveBeenCalledWith("resolve_browser_connection", {
    requestId: "c".repeat(32),
    allow: true,
  });
  await expect(browserApprovalApi.resolve("invalid", false)).rejects.toThrow(
    "Invalid browser approval request",
  );
  expect(mocks.invoke).toHaveBeenCalledOnce();
});
