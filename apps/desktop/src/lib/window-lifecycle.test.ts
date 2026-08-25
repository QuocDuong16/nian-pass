import { afterEach, expect, test, vi } from "vitest";

const onCloseRequested = vi.fn();
const onFocusChanged =
  vi.fn<
    (handler: (event: { payload: boolean }) => void) => Promise<() => void>
  >();
const close = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested, onFocusChanged, close }),
}));

import { desktopWindowLifecycle } from "./window-lifecycle";

afterEach(() => {
  vi.clearAllMocks();
});

test("desktop lifecycle delegates close observation and the explicit close request", async () => {
  const unlisten = vi.fn();
  onCloseRequested.mockResolvedValue(unlisten);
  close.mockResolvedValue(undefined);
  const handler = vi.fn();

  await expect(desktopWindowLifecycle.onCloseRequested(handler)).resolves.toBe(
    unlisten,
  );
  expect(onCloseRequested).toHaveBeenCalledWith(handler);
  await desktopWindowLifecycle.requestClose();
  expect(close).toHaveBeenCalledOnce();
});

test("desktop lifecycle exposes only the boolean focus payload", async () => {
  const unlisten = vi.fn();
  let rawHandler: (event: { payload: boolean }) => void = () => {
    throw new Error("focus handler missing");
  };
  onFocusChanged.mockImplementation((handler) => {
    rawHandler = handler;
    return Promise.resolve(unlisten);
  });
  const handler = vi.fn();

  await expect(desktopWindowLifecycle.onFocusChanged?.(handler)).resolves.toBe(
    unlisten,
  );
  rawHandler({ payload: false });
  rawHandler({ payload: true });
  expect(handler).toHaveBeenNthCalledWith(1, false);
  expect(handler).toHaveBeenNthCalledWith(2, true);
});
