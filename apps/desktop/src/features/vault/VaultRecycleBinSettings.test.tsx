import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi, type MockedFunction } from "vitest";

import { DesktopCommandError, type DesktopApi } from "../../lib/desktop";
import { mutationApi, mutationSnapshot } from "../../test/desktop-api";
import { VaultRecycleBinSettings } from "./VaultRecycleBinSettings";

afterEach(cleanup);

function renderSetting(
  overrides: {
    enabled?: boolean;
    writable?: boolean;
    disabled?: boolean;
    setRecycleBinEnabled?: MockedFunction<DesktopApi["setRecycleBinEnabled"]>;
  } = {},
) {
  const snapshot = {
    ...mutationSnapshot,
    recycleBinEnabled: overrides.enabled ?? true,
    capabilities: {
      ...mutationSnapshot.capabilities,
      writable: overrides.writable ?? true,
    },
  };
  const nextSnapshot = {
    ...snapshot,
    recycleBinEnabled: !snapshot.recycleBinEnabled,
    dirty: true,
  };
  const setRecycleBinEnabled =
    overrides.setRecycleBinEnabled ??
    vi.fn<DesktopApi["setRecycleBinEnabled"]>().mockResolvedValue(nextSnapshot);
  const onBusyChange = vi.fn();
  const onSnapshot = vi.fn();
  render(
    <VaultRecycleBinSettings
      api={mutationApi({ setRecycleBinEnabled })}
      snapshot={snapshot}
      disabled={overrides.disabled ?? false}
      onBusyChange={onBusyChange}
      onSnapshot={onSnapshot}
    />,
  );
  return { setRecycleBinEnabled, onBusyChange, onSnapshot, nextSnapshot };
}

test("Trash setting toggles through the semantic API and replaces the canonical snapshot", async () => {
  const controller = renderSetting();
  fireEvent.click(screen.getByRole("button", { name: "Disable Trash" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Trash disabled");
  expect(controller.setRecycleBinEnabled).toHaveBeenCalledWith(false);
  expect(controller.onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(controller.onSnapshot).toHaveBeenCalledWith(controller.nextSnapshot);
});

test("disabled Trash can be enabled while nonempty disable and generic failures stay explicit", async () => {
  const enable = renderSetting({ enabled: false });
  fireEvent.click(screen.getByRole("button", { name: "Enable Trash" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Trash enabled");
  expect(enable.setRecycleBinEnabled).toHaveBeenCalledWith(true);
  cleanup();

  const nonempty = renderSetting({
    setRecycleBinEnabled: vi
      .fn<DesktopApi["setRecycleBinEnabled"]>()
      .mockRejectedValue(new DesktopCommandError("invalid_request")),
  });
  fireEvent.click(screen.getByRole("button", { name: "Disable Trash" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Empty Trash");
  expect(nonempty.onSnapshot).not.toHaveBeenCalled();
  cleanup();

  renderSetting({
    setRecycleBinEnabled: vi
      .fn<DesktopApi["setRecycleBinEnabled"]>()
      .mockRejectedValue(new Error("synthetic")),
  });
  fireEvent.click(screen.getByRole("button", { name: "Disable Trash" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Could not change",
  );
});

test("read-only or externally disabled settings cannot mutate Trash policy", () => {
  const readOnly = renderSetting({ writable: false });
  expect(screen.getByRole("button", { name: "Disable Trash" })).toBeDisabled();
  expect(readOnly.setRecycleBinEnabled).not.toHaveBeenCalled();
  cleanup();
  const disabled = renderSetting({ disabled: true });
  expect(screen.getByRole("button", { name: "Disable Trash" })).toBeDisabled();
  expect(disabled.setRecycleBinEnabled).not.toHaveBeenCalled();
});
