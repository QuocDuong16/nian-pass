import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { PasswordGenerator } from "./PasswordGenerator";

afterEach(cleanup);

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
