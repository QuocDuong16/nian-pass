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

test("iOS unlock mounts a strict read-only browse and never probes Android requests", async () => {
  const api = createMobileApi({
    selectVault: vi.fn().mockResolvedValue({
      fileName: "ios-fixture.kdbx",
      writable: false,
    }),
  });
  render(<MobileVaultApp api={api} platform="ios" />);
  fireEvent.click(screen.getByRole("button", { name: "Open KDBX" }));
  fireEvent.change(await screen.findByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  expect(await screen.findByText(/iOS · Read only/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Synthetic account/ }));
  expect(await screen.findByText(/Account type · unprotected/)).toBeVisible();
  for (const action of ["Save", "Edit entry", "New entry", "New group"]) {
    expect(
      screen.queryByRole("button", { name: new RegExp(action, "i") }),
    ).not.toBeInTheDocument();
  }
  expect(api.getAutofillRequest).not.toHaveBeenCalled();
  expect(api.updateEntry).not.toHaveBeenCalled();
  expect(api.saveVault).not.toHaveBeenCalled();
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
    .mockResolvedValueOnce({ fileName: "fixture.kdbx", writable: true })
    .mockResolvedValueOnce(null);
  await selectVault(createMobileApi({ selectVault: select }));
  fireEvent.click(screen.getByRole("button", { name: "Choose another vault" }));
  await waitFor(() => {
    expect(select).toHaveBeenCalledTimes(2);
  });
  expect(screen.getByText("fixture.kdbx")).toBeVisible();
});

test("unlocked writable browse exposes CRUD but never general Reveal or Copy", async () => {
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
  for (const action of ["Save", "Edit entry", "New entry", "New group"]) {
    expect(
      screen.getByRole("button", { name: new RegExp(action, "i") }),
    ).toBeVisible();
  }
  for (const action of ["Reveal", "Copy"]) {
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
  expect(await screen.findByText(/could not safely release/i)).toBeVisible();
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

test("mobile entry edit, creation, and custom fields replace state from Rust receipts", async () => {
  const api = await selectVault();
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Synthetic account/ }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Edit entry" }));
  expect(screen.queryByDisplayValue("old-password")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Mobile edited" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledWith({
      entryId: "entry-a",
      title: "Mobile edited",
      username: "mobile-user",
    });
  });

  fireEvent.click(
    await screen.findByRole("button", { name: /Synthetic account/ }),
  );
  await screen.findByText("Account type");
  fireEvent.click(screen.getByRole("button", { name: "Add custom field" }));
  fireEvent.change(screen.getByLabelText("Field name"), {
    target: { value: "Mobile field" },
  });
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "component-local secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => {
    expect(api.setEntryCustomField).toHaveBeenCalledWith({
      entryId: "entry-a",
      name: "Mobile field",
      value: "component-local secret",
      protection: "protected",
    });
  });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "New entry" })).toBeEnabled();
  });
  fireEvent.click(screen.getByRole("button", { name: "New entry" }));
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Created on mobile" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create entry" }));
  await waitFor(() => {
    expect(api.createEntry).toHaveBeenCalledWith({
      groupId: "group-root",
      title: "Created on mobile",
      username: "",
      url: "",
      password: null,
      notes: null,
    });
  });
});

test("mobile move, delete, and group callbacks follow canonical Rust snapshots", async () => {
  const api = await selectVault();
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "demopass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByRole("button", { name: "New group" });

  fireEvent.click(screen.getByRole("button", { name: "New group" }));
  fireEvent.change(screen.getByLabelText("Group name"), {
    target: { value: "Created child" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => {
    expect(api.createGroup).toHaveBeenCalledWith("group-root", "Created child");
  });

  fireEvent.click(screen.getByRole("button", { name: /Synthetic account/ }));
  await screen.findByRole("button", { name: "Move entry" });
  fireEvent.click(screen.getByRole("button", { name: "Move entry" }));
  fireEvent.change(screen.getByLabelText("Destination group"), {
    target: { value: "group-child" },
  });
  const confirmMove = screen
    .getAllByRole("button", { name: "Move entry" })
    .at(-1);
  if (confirmMove === undefined) throw new Error("move confirmation missing");
  fireEvent.click(confirmMove);
  await waitFor(() => {
    expect(api.moveEntry).toHaveBeenCalledWith("entry-a", "group-child");
  });

  fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
  fireEvent.click(screen.getByRole("button", { name: "Rename group" }));
  fireEvent.change(screen.getByLabelText("Group name"), {
    target: { value: "Renamed accounts" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => {
    expect(api.renameGroup).toHaveBeenCalledWith(
      "group-child",
      "Renamed accounts",
    );
  });
});
