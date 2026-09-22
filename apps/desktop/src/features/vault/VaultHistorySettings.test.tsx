import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { DesktopApi } from "../../lib/desktop";
import { mutationApi, mutationSnapshot } from "../../test/desktop-api";
import { VaultHistorySettings } from "./VaultHistorySettings";

afterEach(cleanup);

function renderSetting(overrides: Partial<DesktopApi> = {}) {
  const api = mutationApi({
    getHistoryPolicy: vi.fn().mockResolvedValue({
      maxItems: 10,
      maximumEditableItems: 10_000,
    }),
    setHistoryMaxItems: vi.fn().mockResolvedValue({
      policy: { maxItems: 2, maximumEditableItems: 10_000 },
      snapshot: { ...mutationSnapshot, dirty: true },
    }),
    ...overrides,
  });
  const onBusyChange = vi.fn();
  const onSnapshot = vi.fn();
  render(
    <VaultHistorySettings
      api={api}
      disabled={false}
      onBusyChange={onBusyChange}
      onSnapshot={onSnapshot}
    />,
  );
  return { api, onBusyChange, onSnapshot };
}

test("history retention loads on demand, warns before pruning, and replaces canonical snapshot", async () => {
  const controller = renderSetting();
  const input = await screen.findByLabelText("Maximum revisions per entry");
  expect(input).toHaveValue("10");
  expect(controller.api.getHistoryPolicy).toHaveBeenCalledTimes(1);

  fireEvent.change(input, { target: { value: "2" } });
  expect(screen.getByRole("note")).toHaveTextContent(
    "immediately removes older revisions",
  );
  fireEvent.click(screen.getByRole("button", { name: "Update history limit" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "History retention updated",
  );
  expect(controller.api.setHistoryMaxItems).toHaveBeenCalledWith(2);
  expect(controller.onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(controller.onSnapshot).toHaveBeenCalledWith({
    ...mutationSnapshot,
    dirty: true,
  });
});

test("blank means no finite item limit while zero remains an explicit valid limit", async () => {
  const setHistoryMaxItems = vi
    .fn<DesktopApi["setHistoryMaxItems"]>()
    .mockResolvedValueOnce({
      policy: { maxItems: null, maximumEditableItems: 10_000 },
      snapshot: { ...mutationSnapshot, dirty: true },
    })
    .mockResolvedValueOnce({
      policy: { maxItems: 0, maximumEditableItems: 10_000 },
      snapshot: { ...mutationSnapshot, dirty: true },
    });
  const controller = renderSetting({ setHistoryMaxItems });
  const input = await screen.findByLabelText("Maximum revisions per entry");

  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Update history limit" }));
  await screen.findByText(/History retention updated/);
  expect(setHistoryMaxItems).toHaveBeenNthCalledWith(1, null);

  fireEvent.change(input, { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Update history limit" }));
  await screen.findByText(/History retention updated/);
  expect(setHistoryMaxItems).toHaveBeenNthCalledWith(2, 0);
  expect(controller.onSnapshot).toHaveBeenCalledTimes(2);
});

test("invalid bounds and backend failures never replace the snapshot", async () => {
  const setHistoryMaxItems = vi
    .fn<DesktopApi["setHistoryMaxItems"]>()
    .mockRejectedValue(new Error("synthetic"));
  const controller = renderSetting({ setHistoryMaxItems });
  const input = await screen.findByLabelText("Maximum revisions per entry");

  fireEvent.change(input, { target: { value: "10001" } });
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByRole("button", { name: "Update history limit" }),
  ).toBeDisabled();

  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Update history limit" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Could not update history retention",
  );
  expect(controller.onSnapshot).not.toHaveBeenCalled();
});
