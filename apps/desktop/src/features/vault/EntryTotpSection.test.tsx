import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  mutationApi,
  mutationDetail,
  mutationSnapshot,
} from "../../test/desktop-api";
import { EntryTotpSection } from "./EntryTotpSection";

const URI = "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&period=30&digits=6";

function renderSection(
  options: {
    present?: boolean;
    clearRevealsVersion?: number;
    api?: ReturnType<typeof mutationApi>;
  } = {},
) {
  const api = options.api ?? mutationApi();
  const onSnapshot = vi.fn();
  const view = render(
    <EntryTotpSection
      api={api}
      detail={{ ...mutationDetail, totpPresent: options.present ?? false }}
      disabled={false}
      mutationDisabled={false}
      recycled={false}
      clearRevealsVersion={options.clearRevealsVersion ?? 0}
      onSnapshot={onSnapshot}
    />,
  );
  return { api, onSnapshot, ...view };
}

afterEach(cleanup);

test("configures TOTP through the atomic entry update without preloading an existing seed", async () => {
  const api = mutationApi();
  renderSection({ api });
  expect(api.revealEntryTotp).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Configure TOTP" }));
  const input = screen.getByLabelText("Provisioning URI");
  expect(input).toHaveValue("");
  fireEvent.change(input, { target: { value: URI } });
  fireEvent.click(screen.getByRole("button", { name: "Save TOTP" }));

  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledWith({
      entryId: mutationDetail.id,
      totpEnabled: true,
      totpUri: URI,
    });
  });
});

test("invalid provisioning URI stays local and cannot invoke a mutation", () => {
  const api = mutationApi();
  renderSection({ api });
  fireEvent.click(screen.getByRole("button", { name: "Configure TOTP" }));
  fireEvent.change(screen.getByLabelText("Provisioning URI"), {
    target: { value: "https://example.test/not-totp" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    /valid TOTP provisioning URI/,
  );
  expect(screen.getByRole("button", { name: "Save TOTP" })).toBeDisabled();
  expect(api.updateEntry).not.toHaveBeenCalled();
});

test("explicit reveal and copy use narrow TOTP APIs and privacy clear hides the code", async () => {
  const api = mutationApi({
    revealEntryTotp: vi.fn().mockResolvedValue({
      code: "654321",
      validForSeconds: 20,
      periodSeconds: 30,
    }),
  });
  const { rerender } = renderSection({ present: true, api });

  expect(screen.queryByText("654321")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show code" }));
  expect(await screen.findByText("654321")).toBeVisible();
  expect(api.revealEntryTotp).toHaveBeenCalledWith(mutationDetail.id);

  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => {
    expect(api.copyEntryTotp).toHaveBeenCalledWith(mutationDetail.id);
  });
  expect(await screen.findByText(/TOTP copied/)).toBeVisible();

  rerender(
    <EntryTotpSection
      api={api}
      detail={{ ...mutationDetail, totpPresent: true }}
      disabled={false}
      mutationDisabled={false}
      recycled={false}
      clearRevealsVersion={1}
      onSnapshot={vi.fn()}
    />,
  );
  await waitFor(() => {
    expect(screen.queryByText("654321")).not.toBeInTheDocument();
  });
});

test("removing TOTP uses the same atomic update contract", async () => {
  const api = mutationApi();
  const onSnapshot = vi.fn();
  render(
    <EntryTotpSection
      api={api}
      detail={{ ...mutationDetail, totpPresent: true }}
      disabled={false}
      mutationDisabled={false}
      recycled={false}
      clearRevealsVersion={0}
      onSnapshot={onSnapshot}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove TOTP" }));

  await waitFor(() => {
    expect(api.updateEntry).toHaveBeenCalledWith({
      entryId: mutationDetail.id,
      totpEnabled: false,
    });
  });
  expect(onSnapshot).toHaveBeenCalledWith(mutationSnapshot);
});

test("TOTP reveal and copy failures stay local and never expose a stale code", async () => {
  const api = mutationApi({
    revealEntryTotp: vi
      .fn()
      .mockRejectedValue(new Error("synthetic reveal failure")),
    copyEntryTotp: vi
      .fn()
      .mockRejectedValue(new Error("synthetic copy failure")),
  });
  renderSection({ present: true, api });

  fireEvent.click(screen.getByRole("button", { name: "Show code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not generate this TOTP code.",
  );
  expect(screen.queryByText(/^\d{6,10}$/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  expect(
    await screen.findByText("Could not copy the TOTP code."),
  ).toBeVisible();
});

test("TOTP editor can cancel and reports a rejected atomic mutation", async () => {
  const api = mutationApi({
    updateEntry: vi
      .fn()
      .mockRejectedValue(new Error("synthetic mutation failure")),
  });
  renderSection({ present: true, api });

  fireEvent.click(screen.getByRole("button", { name: "Replace" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Replace" }));
  fireEvent.change(screen.getByLabelText("Provisioning URI"), {
    target: { value: URI },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save TOTP" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not update the TOTP configuration.",
  );
});
