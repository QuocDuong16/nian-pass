import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { mutationApi } from "../../test/desktop-api";
import { QuickPasswordGenerator } from "./QuickPasswordGenerator";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderGenerator(overrides = {}) {
  const api = mutationApi(overrides);
  const onClose = vi.fn();
  const result = render(
    <QuickPasswordGenerator
      api={api}
      disabled={false}
      privacyVersion={0}
      onClose={onClose}
    />,
  );
  return { api, onClose, ...result };
}

function generateCharacters() {
  fireEvent.click(screen.getByRole("button", { name: "Generate password" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  const value = screen.getByLabelText<HTMLInputElement>("Generated value");
  return value;
}

test("generates a masked standalone secret without vault writes or automatic copy", async () => {
  const { api, onClose } = renderGenerator();
  expect(screen.getByText("Nothing generated yet.")).toBeVisible();
  expect(screen.queryByLabelText("Generated value")).not.toBeInTheDocument();

  const value = generateCharacters();
  expect(value).toHaveAttribute("type", "password");
  expect(value.value).toHaveLength(24);
  expect(value).toHaveAttribute("readonly");
  expect(api.copyGeneratedPassword).not.toHaveBeenCalled();
  expect(api.createEntry).not.toHaveBeenCalled();
  expect(api.updateEntry).not.toHaveBeenCalled();
  expect(api.saveVault).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Show value" }));
  expect(value).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Hide value" }));
  expect(value).toHaveAttribute("type", "password");

  fireEvent.click(screen.getByRole("button", { name: "Copy generated value" }));
  await waitFor(() => {
    expect(api.copyGeneratedPassword).toHaveBeenCalledWith(value.value);
  });
  expect(
    await screen.findByText(/Clipboard clears in 30s if unchanged/u),
  ).toBeVisible();
  expect(api.createEntry).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledOnce();
});

test("passphrase mode copies the current generation and regeneration resets reveal", async () => {
  const { api } = renderGenerator();
  fireEvent.click(screen.getByRole("button", { name: "Generate password" }));
  fireEvent.click(screen.getByRole("button", { name: "Passphrase" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  const value = screen.getByLabelText<HTMLInputElement>("Generated value");
  expect(value.value.split("-")).toHaveLength(6);
  fireEvent.click(screen.getByRole("button", { name: "Show value" }));
  expect(value).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  expect(value).toHaveAttribute("type", "password");
  const current = value.value;
  fireEvent.click(screen.getByRole("button", { name: "Copy generated value" }));
  await waitFor(() => {
    expect(api.copyGeneratedPassword).toHaveBeenCalledWith(current);
  });
});

test("copy rejection has generic feedback and never writes an entry", async () => {
  const apiCopy = vi
    .fn()
    .mockRejectedValue(new Error("sensitive native details"));
  const { api } = renderGenerator({ copyGeneratedPassword: apiCopy });
  generateCharacters();
  fireEvent.click(screen.getByRole("button", { name: "Copy generated value" }));
  expect(
    await screen.findByText("Could not copy to the clipboard."),
  ).toBeVisible();
  expect(
    screen.queryByText(/sensitive native details/u),
  ).not.toBeInTheDocument();
  expect(api.createEntry).not.toHaveBeenCalled();
});

test("Escape, blur, visibility and privacy changes dispose the standalone secret", () => {
  const { onClose, rerender, api } = renderGenerator();
  generateCharacters();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();

  onClose.mockClear();
  fireEvent(window, new Event("blur"));
  expect(onClose).toHaveBeenCalledOnce();

  onClose.mockClear();
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  expect(onClose).toHaveBeenCalledOnce();
  visibility.mockRestore();

  onClose.mockClear();
  rerender(
    <QuickPasswordGenerator
      api={api}
      disabled={false}
      privacyVersion={1}
      onClose={onClose}
    />,
  );
  expect(onClose).toHaveBeenCalledOnce();
});
