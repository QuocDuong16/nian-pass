import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { DesktopCommandError } from "../../lib/desktop";
import { mutationApi } from "../../test/desktop-api";
import { VaultExportSettings } from "./VaultExportSettings";

afterEach(cleanup);

test("export copy reports success without replacing the active snapshot", async () => {
  const exportVaultCopy = vi.fn().mockResolvedValue(true);
  const onBusyChange = vi.fn();
  render(
    <VaultExportSettings
      api={mutationApi({ exportVaultCopy })}
      disabled={false}
      onBusyChange={onBusyChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Export copy" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "current vault remains selected",
  );
  expect(exportVaultCopy).toHaveBeenCalledOnce();
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
});

test("picker cancellation is silent and disabled state never invokes export", async () => {
  const exportVaultCopy = vi.fn().mockResolvedValue(false);
  const { rerender } = render(
    <VaultExportSettings
      api={mutationApi({ exportVaultCopy })}
      disabled={false}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Export copy" }));
  await vi.waitFor(() => {
    expect(exportVaultCopy).toHaveBeenCalledOnce();
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();

  rerender(
    <VaultExportSettings
      api={mutationApi({ exportVaultCopy })}
      disabled
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Export copy" }));
  expect(exportVaultCopy).toHaveBeenCalledOnce();
});

test.each([
  ["vault_already_exists" as const, "Choose a new filename"],
  ["unsupported_write_format" as const, "cannot be exported"],
  ["operation_in_progress" as const, "Another vault operation"],
])("export maps %s to safe feedback", async (code, message) => {
  const exportVaultCopy = vi
    .fn()
    .mockRejectedValue(new DesktopCommandError(code));
  render(
    <VaultExportSettings
      api={mutationApi({ exportVaultCopy })}
      disabled={false}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Export copy" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
});

test("unknown export failures stay generic", async () => {
  const exportVaultCopy = vi
    .fn()
    .mockRejectedValue(new Error("private detail"));
  render(
    <VaultExportSettings
      api={mutationApi({ exportVaultCopy })}
      disabled={false}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Export copy" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "current vault was not changed",
  );
});
