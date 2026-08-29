import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { desktopApi, type RuntimeApi } from "../lib/desktop";
import type { DesktopWindowLifecycle } from "../lib/window-lifecycle";
import type { RuntimePlatform } from "../types/runtime";
import { ApplicationRoot } from "./ApplicationRoot";
import { createMobileApi } from "../test/mobile-api";

afterEach(() => {
  vi.restoreAllMocks();
});

function runtime(platform: RuntimePlatform): RuntimeApi {
  return { getInfo: vi.fn().mockResolvedValue({ platform }) };
}

function lifecycle(): DesktopWindowLifecycle {
  return {
    onCloseRequested: vi.fn().mockResolvedValue(() => undefined),
    onFocusChanged: vi.fn().mockResolvedValue(() => undefined),
    isFocused: vi.fn().mockResolvedValue(true),
    requestClose: vi.fn().mockResolvedValue(undefined),
  };
}

test("desktop runtime mounts the existing desktop application", async () => {
  const windowLifecycle = lifecycle();
  render(
    <ApplicationRoot
      runtime={runtime("desktop")}
      windowLifecycle={windowLifecycle}
    />,
  );

  expect(
    await screen.findByRole("button", { name: "Choose KDBX file" }),
  ).toBeVisible();
  await waitFor(() => {
    expect(windowLifecycle.onCloseRequested).toHaveBeenCalledOnce();
  });
});

test("Android mounts the mobile vault app without desktop lifecycle", async () => {
  const windowLifecycle = lifecycle();
  const mobile = createMobileApi();
  const closePolicy = vi.spyOn(desktopApi, "closePolicy");

  render(
    <ApplicationRoot
      runtime={runtime("android")}
      windowLifecycle={windowLifecycle}
      mobile={mobile}
    />,
  );

  expect(
    await screen.findByRole("button", { name: "Open KDBX" }),
  ).toBeVisible();
  expect(windowLifecycle.onCloseRequested).not.toHaveBeenCalled();
  expect(windowLifecycle.onFocusChanged).not.toHaveBeenCalled();
  expect(closePolicy).not.toHaveBeenCalled();
});

test("iOS mounts the read-only mobile vault flow without desktop lifecycle", async () => {
  const windowLifecycle = lifecycle();
  const mobile = createMobileApi();
  render(
    <ApplicationRoot
      runtime={runtime("ios")}
      windowLifecycle={windowLifecycle}
      mobile={mobile}
    />,
  );

  expect(
    await screen.findByRole("button", { name: "Open KDBX" }),
  ).toBeVisible();
  expect(windowLifecycle.onCloseRequested).not.toHaveBeenCalled();
  expect(mobile.selectVault).not.toHaveBeenCalled();
  expect(mobile.unlockVault).not.toHaveBeenCalled();
});

test("invalid runtime bootstrap fails closed without mounting desktop", async () => {
  const windowLifecycle = lifecycle();
  render(
    <ApplicationRoot
      runtime={{ getInfo: vi.fn().mockRejectedValue(new Error("invalid")) }}
      windowLifecycle={windowLifecycle}
    />,
  );

  expect(
    await screen.findByText("Nian Pass could not verify the runtime platform."),
  ).toBeVisible();
  expect(windowLifecycle.onCloseRequested).not.toHaveBeenCalled();
});
