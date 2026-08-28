import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { createMobileApi } from "../../test/mobile-api";
import type { MobileApi, MobileAutofillRequestDto } from "../../types/mobile";
import { MobileVaultApp } from "./MobileVaultApp";
import { MobileAutofillSettings } from "./MobileAutofillSettings";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const request: MobileAutofillRequestDto = {
  requestToken: "opaque-request-token",
  kind: "autofill",
  targetDisplay: "example.test",
  requiresConfirmation: true,
  selectedEntryId: null,
};

function credentialApi(overrides: Partial<MobileApi> = {}) {
  return createMobileApi({
    getAutofillRequest: vi.fn().mockResolvedValue({
      request,
      selectedVault: { fileName: "fixture.kdbx", writable: true },
    }),
    getAutofillCandidates: vi.fn().mockResolvedValue([
      {
        entryId: "entry-a",
        title: { kind: "visible", value: "Synthetic account" },
        username: { kind: "visible", value: "mobile-user" },
      },
      {
        entryId: "entry-b",
        title: { kind: "protected" },
        username: { kind: "protected" },
      },
    ]),
    ...overrides,
  });
}

async function unlockCredentialRequest(api = credentialApi()) {
  render(<MobileVaultApp api={api} />);
  expect(await screen.findByText("fixture.kdbx")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Master password"), {
    target: { value: "attempt-only" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  expect(await screen.findByText("Fill credentials for:")).toBeVisible();
  return api;
}

test("locked credential route rehydrates, unlocks, and never renders a password", async () => {
  await unlockCredentialRequest();
  expect(screen.getByText("example.test")).toBeVisible();
  expect(screen.queryByText("attempt-only")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  expect(
    await screen.findAllByRole("button", {
      name: /Synthetic account|Protected account/,
    }),
  ).toHaveLength(2);
});

test("unverified target requires an intentional candidate approval", async () => {
  const api = await unlockCredentialRequest();
  expect(screen.getByText(/could not verify/i)).toBeVisible();
  fireEvent.click(
    await screen.findByRole("button", { name: /Synthetic account/ }),
  );
  await waitFor(() => {
    expect(api.approveAutofill).toHaveBeenCalledWith(
      "opaque-request-token",
      "entry-a",
      true,
    );
  });
  expect(await screen.findByText("Returning to Android…")).toBeVisible();
});

test("credential-manager authentication returns secret-free candidates to Android", async () => {
  const api = await unlockCredentialRequest(
    credentialApi({
      getAutofillRequest: vi.fn().mockResolvedValue({
        request: { ...request, kind: "credential_query" },
        selectedVault: { fileName: "fixture.kdbx", writable: true },
      }),
    }),
  );
  await waitFor(() => {
    expect(api.publishAutofillCandidates).toHaveBeenCalledWith(
      "opaque-request-token",
    );
  });
  expect(api.approveAutofill).not.toHaveBeenCalled();
});

test("cancel invalidates the active Android request", async () => {
  const api = await unlockCredentialRequest();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => {
    expect(api.cancelAutofill).toHaveBeenCalledWith("opaque-request-token");
  });
});

test("an already-unlocked Rust session serves the credential route without another unlock", async () => {
  const api = credentialApi({
    getAutofillRequest: vi.fn().mockResolvedValue({
      request,
      selectedVault: null,
    }),
  });
  render(<MobileVaultApp api={api} />);
  expect(await screen.findByText("Fill credentials for:")).toBeVisible();
  expect(api.getVaultSnapshot).toHaveBeenCalledOnce();
  expect(api.unlockVault).not.toHaveBeenCalled();
});

test("Autofill source settings explicitly enable, disable, and open Android setup", async () => {
  const api = createMobileApi();
  render(<MobileAutofillSettings api={api} />);
  const enable = await screen.findByRole("button", {
    name: "Enable Autofill for this vault",
  });
  fireEvent.click(enable);
  const disable = await screen.findByRole("button", {
    name: "Disable Autofill for this vault",
  });
  expect(api.enableAutofill).toHaveBeenCalledOnce();
  fireEvent.click(disable);
  await waitFor(() => {
    expect(api.disableAutofill).toHaveBeenCalledOnce();
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Open Android provider settings" }),
  );
  expect(api.openAutofillSettings).toHaveBeenCalledOnce();
});

test("Autofill settings failures stay generic", async () => {
  const api = createMobileApi({
    getAutofillStatus: vi.fn().mockRejectedValue(new Error("source-uri")),
  });
  const { unmount } = render(<MobileAutofillSettings api={api} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Autofill status is unavailable.",
  );
  unmount();

  const failingEnable = createMobileApi({
    enableAutofill: vi.fn().mockRejectedValue(new Error("keystore")),
  });
  render(<MobileAutofillSettings api={failingEnable} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Enable Autofill for this vault",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Nian Pass could not change Autofill source access.",
  );
});
