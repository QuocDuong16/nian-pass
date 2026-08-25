import { afterEach, expect, test, vi } from "vitest";

const onCloseRequested = vi.fn();
const close = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested, close }),
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
