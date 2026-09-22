import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { DesktopApi } from "../../lib/desktop";
import { mutationApi, mutationSnapshot } from "../../test/desktop-api";
import { VaultDatabaseMetadataSettings } from "./VaultDatabaseMetadataSettings";

afterEach(cleanup);

function renderSettings(overrides: Partial<DesktopApi> = {}, disabled = false) {
  const api = mutationApi({
    getDatabaseMetadata: vi.fn().mockResolvedValue({
      name: "Personal",
      description: "Primary vault",
      defaultUsername: "fixture-user",
    }),
    updateDatabaseMetadata: vi.fn().mockResolvedValue({
      metadata: {
        name: "Updated",
        description: "Primary vault",
        defaultUsername: "fixture-user",
      },
      snapshot: { ...mutationSnapshot, dirty: true },
    }),
    ...overrides,
  });
  const onBusyChange = vi.fn();
  const onSnapshot = vi.fn();
  render(
    <VaultDatabaseMetadataSettings
      api={api}
      disabled={disabled}
      onBusyChange={onBusyChange}
      onSnapshot={onSnapshot}
    />,
  );
  return { api, onBusyChange, onSnapshot };
}

test("database metadata loads through the explicit settings command and starts unchanged", async () => {
  const controller = renderSettings();
  expect(await screen.findByDisplayValue("Personal")).toBeVisible();
  expect(screen.getByDisplayValue("Primary vault")).toBeVisible();
  expect(screen.getByDisplayValue("fixture-user")).toBeVisible();
  expect(controller.api.getDatabaseMetadata).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Update details" })).toBeDisabled();
});

test("database metadata update uses one atomic API and replaces the canonical dirty snapshot", async () => {
  const controller = renderSettings();
  const name = await screen.findByDisplayValue("Personal");
  fireEvent.change(name, { target: { value: "Updated" } });
  fireEvent.click(screen.getByRole("button", { name: "Update details" }));
  expect(await screen.findByText(/Save the vault to persist/)).toBeVisible();
  expect(controller.api.updateDatabaseMetadata).toHaveBeenCalledWith(
    "Updated",
    "Primary vault",
    "fixture-user",
  );
  expect(controller.onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(controller.onSnapshot).toHaveBeenCalledWith({
    ...mutationSnapshot,
    dirty: true,
  });
  expect(screen.getByRole("button", { name: "Update details" })).toBeDisabled();
});

test("metadata load/update failures stay explicit and disabled settings cannot mutate", async () => {
  renderSettings({
    getDatabaseMetadata: vi.fn().mockRejectedValue(new Error("synthetic")),
  });
  expect(
    await screen.findByText("Could not load database details."),
  ).toBeVisible();
  cleanup();

  const failing = renderSettings({
    updateDatabaseMetadata: vi.fn().mockRejectedValue(new Error("synthetic")),
  });
  const name = await screen.findByDisplayValue("Personal");
  fireEvent.change(name, { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "Update details" }));
  expect(
    await screen.findByText("Could not update database details."),
  ).toBeVisible();
  expect(failing.onSnapshot).not.toHaveBeenCalled();
  cleanup();

  const disabled = renderSettings({}, true);
  expect(await screen.findByDisplayValue("Personal")).toBeDisabled();
  expect(disabled.api.updateDatabaseMetadata).not.toHaveBeenCalled();
});
