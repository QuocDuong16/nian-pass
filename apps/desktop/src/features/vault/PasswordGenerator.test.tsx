import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { PasswordGenerator } from "./PasswordGenerator";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("generator updates quality, options, and emits a generated password", () => {
  const onGenerated = vi.fn();
  render(<PasswordGenerator onGenerated={onGenerated} />);

  fireEvent.click(screen.getByRole("button", { name: "Generate password" }));
  expect(screen.getByText("Password quality: Strong")).toBeVisible();

  fireEvent.change(screen.getByLabelText("Length"), {
    target: { value: "14" },
  });
  fireEvent.click(screen.getByLabelText("Digits"));
  fireEvent.click(screen.getByLabelText("Symbols"));
  expect(screen.getByText("Password quality: Good")).toBeVisible();

  fireEvent.change(screen.getByLabelText("Length"), { target: { value: "8" } });
  fireEvent.click(screen.getByLabelText("Lowercase"));
  fireEvent.click(screen.getByLabelText("Avoid ambiguous characters"));
  expect(screen.getByText("Password quality: Basic")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  expect(onGenerated).toHaveBeenCalledOnce();
  expect(onGenerated.mock.calls[0]?.[0]).toMatch(/^[A-Z]{8}$/u);
});

test("generator disables generation when every character set is off", () => {
  render(<PasswordGenerator onGenerated={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Generate password" }));

  for (const label of ["Uppercase", "Lowercase", "Digits", "Symbols"]) {
    fireEvent.click(screen.getByLabelText(label));
  }

  expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
});

test("disabled generator never opens its controls", () => {
  render(<PasswordGenerator disabled onGenerated={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "Generate password" });
  expect(trigger).toBeDisabled();
  fireEvent.click(trigger);
  expect(screen.queryByLabelText("Length")).not.toBeInTheDocument();
});

test("passphrase mode generates offline word-based local drafts without auto-saving", () => {
  const onGenerated = vi.fn();
  render(<PasswordGenerator onGenerated={onGenerated} />);
  fireEvent.click(screen.getByRole("button", { name: "Generate password" }));
  fireEvent.click(screen.getByRole("button", { name: "Passphrase" }));

  expect(screen.queryByLabelText("Length")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Passphrase" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByText(/7,772-word EFF-based list/u)).toBeVisible();
  expect(onGenerated).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Words"), {
    target: { value: "7" },
  });
  fireEvent.change(screen.getByLabelText("Separator"), {
    target: { value: " " },
  });
  fireEvent.click(screen.getByLabelText("Capitalize words"));
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));

  expect(onGenerated).toHaveBeenCalledOnce();
  const words = String(onGenerated.mock.calls[0]?.[0]).split(" ");
  expect(words).toHaveLength(7);
  expect(words.every((word) => /^[A-Z][a-z]*$/u.test(word))).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Characters" }));
  expect(screen.getByLabelText("Length")).toHaveValue(24);
  fireEvent.click(screen.getByRole("button", { name: "Passphrase" }));
  expect(screen.getByLabelText("Words")).toHaveValue(7);
  expect(screen.getByLabelText("Separator")).toHaveValue(" ");
});

test("passphrase generation refuses invalid counts instead of silently weakening them", () => {
  const onGenerated = vi.fn();
  render(<PasswordGenerator onGenerated={onGenerated} />);
  fireEvent.click(screen.getByRole("button", { name: "Generate password" }));
  fireEvent.click(screen.getByRole("button", { name: "Passphrase" }));
  const generate = screen.getByRole("button", { name: "Generate" });

  for (const count of ["5", "13", "7.5", ""] as const) {
    fireEvent.change(screen.getByLabelText("Words"), {
      target: { value: count },
    });
    expect(generate).toBeDisabled();
  }
  expect(onGenerated).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Words"), {
    target: { value: "6" },
  });
  expect(generate).toBeEnabled();
});

test("secure RNG errors fail closed in the UI and a later retry works", () => {
  const onGenerated = vi.fn();
  render(<PasswordGenerator onGenerated={onGenerated} />);
  fireEvent.click(screen.getByRole("button", { name: "Generate password" }));
  fireEvent.click(screen.getByRole("button", { name: "Passphrase" }));
  const random = vi.spyOn(globalThis.crypto, "getRandomValues");
  random.mockImplementation(() => {
    throw new Error("no secure RNG");
  });

  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Secure random generation failed",
  );
  expect(onGenerated).not.toHaveBeenCalled();

  random.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(onGenerated).toHaveBeenCalledOnce();
});

test("invalid character lengths never produce short passwords", () => {
  const onGenerated = vi.fn();
  render(<PasswordGenerator onGenerated={onGenerated} />);
  fireEvent.click(screen.getByRole("button", { name: "Generate password" }));
  const generate = screen.getByRole("button", { name: "Generate" });
  for (const length of ["", "7", "129", "8.5"]) {
    fireEvent.change(screen.getByLabelText("Length"), {
      target: { value: length },
    });
    expect(generate).toBeDisabled();
  }
  expect(onGenerated).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Length"), {
    target: { value: "24" },
  });
  expect(generate).toBeEnabled();
});
