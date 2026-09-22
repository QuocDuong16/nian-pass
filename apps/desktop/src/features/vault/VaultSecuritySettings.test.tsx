import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { mutationApi } from "../../test/desktop-api";
import { VaultSecuritySettings } from "./VaultSecuritySettings";

afterEach(cleanup);

test("adding and removing a keyfile updates password removal availability without reopening Settings", async () => {
  const api = mutationApi({
    credentialHasKeyfile: vi.fn().mockResolvedValue(false),
    credentialHasPassword: vi.fn().mockResolvedValue(true),
  });
  render(
    <VaultSecuritySettings
      api={api}
      disabled={false}
      dirty={false}
      writable
      hasDraft={false}
      mutationPending={false}
      autoLockMs={300000}
      onAutoLockChange={vi.fn()}
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Remove master password" }),
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Add keyfile" }));
  expect(
    await screen.findByRole("button", { name: "Remove master password" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Remove keyfile" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm remove keyfile" }),
  );
  expect(
    await screen.findByRole("button", { name: "Add keyfile" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Remove master password" }),
  ).not.toBeInTheDocument();
});
