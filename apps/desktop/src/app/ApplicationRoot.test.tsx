import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { desktopApi, type RuntimeApi } from "../lib/desktop";
import type { DesktopWindowLifecycle } from "../lib/window-lifecycle";
import type { RuntimePlatform } from "../types/runtime";
import { ApplicationRoot } from "./ApplicationRoot";

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

test.each(["android", "ios"] as const)(
  "%s foundation is passive and does not mount desktop vault lifecycle",
  async (platform) => {
    const windowLifecycle = lifecycle();
    const selectVault = vi.spyOn(desktopApi, "selectVault");
    const unlockVault = vi.spyOn(desktopApi, "unlockVault");
    const closePolicy = vi.spyOn(desktopApi, "closePolicy");
    const lockVault = vi.spyOn(desktopApi, "lockVault");

    render(
      <ApplicationRoot
        runtime={runtime(platform)}
        windowLifecycle={windowLifecycle}
      />,
    );

    expect(
      await screen.findByText(
        `${platform === "android" ? "Android" : "iOS"} runtime ready. Vault access arrives in M5.1.`,
      ),
    ).toBeVisible();
    expect(windowLifecycle.onCloseRequested).not.toHaveBeenCalled();
    expect(windowLifecycle.onFocusChanged).not.toHaveBeenCalled();
    expect(selectVault).not.toHaveBeenCalled();
    expect(unlockVault).not.toHaveBeenCalled();
    expect(closePolicy).not.toHaveBeenCalled();
    expect(lockVault).not.toHaveBeenCalled();
  },
);

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
