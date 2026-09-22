import {
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
import { MobileTotpSection } from "./MobileTotpSection";

const URI = "otpauth://totp/Mobile?secret=JBSWY3DPEHPK3PXP&period=30&digits=6";

function renderSection(present = false) {
  const api = createMobileApi();
  const onSnapshot = vi.fn();
  const onDraftChange = vi.fn();
  const onBusyChange = vi.fn();
  render(
    <MobileTotpSection
      api={api}
      detail={{ ...mobileDetail, totpPresent: present }}
      disabled={false}
      readOnly={false}
      onSnapshot={onSnapshot}
      onDraftChange={onDraftChange}
      onBusyChange={onBusyChange}
    />,
  );
  return { api, onSnapshot, onDraftChange, onBusyChange };
}

afterEach(cleanup);

test("mobile TOTP configures without preloading an existing provisioning secret", async () => {
  const { api, onSnapshot } = renderSection(false);
  expect(api.revealEntryTotp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Configure TOTP" }));
  expect(screen.getByLabelText("Provisioning URI")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Provisioning URI"), {
    target: { value: URI },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save TOTP" }));
  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledWith({
      entryId: mobileDetail.id,
      totpEnabled: true,
      totpUri: URI,
    });
  });
  expect(onSnapshot).toHaveBeenCalledWith({ ...mobileSnapshot, dirty: true });
});

test("mobile TOTP reveal returns only an ephemeral code and can be hidden", async () => {
  const api = createMobileApi({
    revealEntryTotp: vi.fn().mockResolvedValue({
      code: "654321",
      validForSeconds: 12,
      periodSeconds: 30,
    }),
  });
  render(
    <MobileTotpSection
      api={api}
      detail={{ ...mobileDetail, totpPresent: true }}
      disabled={false}
      readOnly={false}
      onSnapshot={vi.fn()}
      onDraftChange={vi.fn()}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Show code" }));
  expect(await screen.findByText("654321")).toBeVisible();
  expect(api.revealEntryTotp).toHaveBeenCalledWith(mobileDetail.id);
  fireEvent.click(screen.getByRole("button", { name: "Hide code" }));
  expect(screen.queryByText("654321")).not.toBeInTheDocument();
});

test("mobile TOTP remove uses the same atomic entry update", async () => {
  const { api } = renderSection(true);
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove TOTP" }));
  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledWith({
      entryId: mobileDetail.id,
      totpEnabled: false,
    });
  });
});
