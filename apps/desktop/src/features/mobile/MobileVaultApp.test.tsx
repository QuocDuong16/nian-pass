import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  createMobileApi,
  mobileDetail,
  mobileSnapshot,
} from "../../test/mobile-api";
import type { VaultSnapshotDto } from "../../types/desktop";
import { MobileVaultApp } from "./MobileVaultApp";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function selectVault(api = createMobileApi()) {
  render(<MobileVaultApp api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "Open KDBX" }));
  expect(await screen.findByText("fixture.kdbx")).toBeVisible();
  return api;
}

test("Android selection displays only the reviewed filename", async () => {
  await selectVault();
  expect(screen.queryByText(/content:\/\//i)).not.toBeInTheDocument();
  expect(screen.queryByText(/\/data\/user/i)).not.toBeInTheDocument();
});

test("picker failure remains a generic presentation error", async () => {
  render(
    <MobileVaultApp
      api={createMobileApi({
        selectVault: vi
          .fn()
          .mockRejectedValue(new Error("private native detail")),
      })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open KDBX" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not open the Android document picker",
  );
});

test("password clears before the deferred unlock promise settles", async () => {
  let resolveUnlock: ((snapshot: VaultSnapshotDto) => void) | undefined;
  const unlockVault = vi.fn().mockImplementation(
    () =>
      new Promise<VaultSnapshotDto>((resolve) => {
        resolveUnlock = resolve;
      }),
  );
  const api = await selectVault(createMobileApi({ unlockVault }));
  const field = screen.getByLabelText("Master password");
  fireEvent.change(field, { target: { value: "attempt-only" } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

  expect(field).toHaveValue("");
  expect(api.unlockVault).toHaveBeenCalledWith("attempt-only");
  await act(() => {
    resolveUnlock?.(mobileSnapshot);
    return Promise.resolve();
  });
  expect(await screen.findByText("Synthetic account")).toBeVisible();
});

test("failed unlock stays clear and allows a retry without reopening picker", async () => {
  const unlockVault = vi
    .fn()
    .mockRejectedValueOnce(new Error("wrong password"))
    .mockResolvedValueOnce(mobileSnapshot);
  const api = await selectVault(createMobileApi({ unlockVault }));
  const field = screen.getByLabelText("Master password");
  fireEvent.change(field, { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not unlock",
  );
  expect(field).toHaveValue("");
  expect(api.selectVault).toHaveBeenCalledOnce();

  fireEvent.change(field, { target: { value: "demopass" } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  expect(await screen.findByText("Synthetic account")).toBeVisible();
  expect(api.selectVault).toHaveBeenCalledOnce();
});

test("cancelled replacement preserves the pending display selection", async () => {
  const select = vi
    .fn()
    .mockResolvedValueOnce({ fileName: "fixture.kdbx" })
    .mockResolvedValueOnce(null);
  await selectVault(createMobileApi({ selectVault: select }));
  fireEvent.click(screen.getByRole("button", { name: "Choose another vault" }));
  await waitFor(() => {
    expect(select).toHaveBeenCalledTimes(2);
  });
  expect(screen.getByText("fixture.kdbx")).toBeVisible();
});

test("unlocked browse exposes secret-free detail and no mutation actions", async () => {
  const api = await selectVault();
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Synthetic account/ }),
  );

  expect(
    await screen.findByText(mobileDetail.customFields[0]?.name ?? "missing"),
  ).toBeVisible();
  expect(screen.getAllByText("Password stored")).toHaveLength(2);
  expect(screen.getAllByText("Notes stored")).toHaveLength(2);
  expect(api.getEntryDetail).toHaveBeenCalledWith("entry-a");
  for (const action of [
    "Save",
    "Edit",
    "Delete",
    "Create",
    "Move",
    "Reveal",
    "Copy",
  ]) {
    expect(
      screen.queryByRole("button", { name: new RegExp(action, "i") }),
    ).not.toBeInTheDocument();
  }
});

test("detail and Lock failures remain generic without discarding the browse view", async () => {
  await selectVault(
    createMobileApi({
      getEntryDetail: vi
        .fn()
        .mockRejectedValue(new Error("private parser detail")),
      lockVault: vi.fn().mockRejectedValue(new Error("private mutex detail")),
    }),
  );
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Synthetic account/ }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load that entry",
  );
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not lock the vault",
  );
  expect(screen.getByText("fixture.kdbx")).toBeVisible();
});

test("document hiding shields browse metadata and clears selected detail", async () => {
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  await selectVault();
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Synthetic account/ }),
  );
  expect(await screen.findByText("Account type")).toBeVisible();

  hidden.mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  expect(await screen.findByText("Vault hidden")).toBeVisible();
  expect(screen.queryByText("fixture.kdbx")).not.toBeInTheDocument();

  hidden.mockReturnValue(false);
  fireEvent(document, new Event("visibilitychange"));
  expect(await screen.findByText("fixture.kdbx")).toBeVisible();
  expect(screen.queryByText("Account type")).not.toBeInTheDocument();
});

test("Lock clears browse detail and returns to no-selection state", async () => {
  const api = await selectVault();
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Synthetic account/ }),
  );
  expect(await screen.findByText("Account type")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));

  expect(
    await screen.findByRole("button", { name: "Open KDBX" }),
  ).toBeVisible();
  expect(screen.queryByText("fixture.kdbx")).not.toBeInTheDocument();
  expect(screen.queryByText("Account type")).not.toBeInTheDocument();
  expect(api.lockVault).toHaveBeenCalledOnce();
});

test("a detail response that settles after Lock cannot repopulate presentation state", async () => {
  let resolveDetail: ((detail: typeof mobileDetail) => void) | undefined;
  const getEntryDetail = vi.fn().mockImplementation(
    () =>
      new Promise<typeof mobileDetail>((resolve) => {
        resolveDetail = resolve;
      }),
  );
  const api = await selectVault(createMobileApi({ getEntryDetail }));
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Synthetic account/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Lock" }));
  expect(
    await screen.findByRole("button", { name: "Open KDBX" }),
  ).toBeVisible();
  await act(() => {
    resolveDetail?.(mobileDetail);
    return Promise.resolve();
  });
  expect(api.lockVault).toHaveBeenCalledOnce();
  expect(screen.queryByText("Account type")).not.toBeInTheDocument();
});
