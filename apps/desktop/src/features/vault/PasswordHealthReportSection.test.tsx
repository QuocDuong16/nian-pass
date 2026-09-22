import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { mutationApi } from "../../test/desktop-api";
import { PasswordHealthReportSection } from "./PasswordHealthReportSection";

afterEach(cleanup);

const report = {
  totalEntries: 4,
  passwordEntries: 3,
  minimumLength: 12,
  weakScoreThreshold: 3,
  issues: [
    {
      entryId: "entry-a",
      groupId: "group-root",
      title: { kind: "visible" as const, value: "Reusable account" },
      missingPassword: false,
      emptyPassword: false,
      reusedPassword: true,
      belowMinimumLength: true,
      weakPassword: true,
      strengthScore: 2,
    },
    {
      entryId: "entry-b",
      groupId: "group-root",
      title: { kind: "protected" as const },
      missingPassword: true,
      emptyPassword: false,
      reusedPassword: false,
      belowMinimumLength: false,
      weakPassword: false,
      strengthScore: null,
    },
  ],
};

test("password health runs only on demand and renders secret-free issue metadata", async () => {
  const getPasswordHealthReport = vi.fn().mockResolvedValue(report);
  render(
    <PasswordHealthReportSection
      api={mutationApi({ getPasswordHealthReport })}
      disabled={false}
    />,
  );

  expect(getPasswordHealthReport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Run check" }));
  await screen.findByText("Reusable account");

  expect(getPasswordHealthReport).toHaveBeenCalledOnce();
  expect(screen.getByText("Reused password")).toBeVisible();
  expect(screen.getByText("Under 12 characters")).toBeVisible();
  expect(screen.getByText("Weak local score")).toBeVisible();
  expect(screen.getByText("Local score 2/4")).toBeVisible();
  expect(screen.getByText("Missing password")).toBeVisible();
  expect(screen.getByLabelText("Protected")).toBeVisible();
  expect(screen.getByText("2")).toBeVisible();
});

test("password health failure is retryable and disabled state never invokes Rust", async () => {
  const getPasswordHealthReport = vi
    .fn()
    .mockRejectedValueOnce(new Error("synthetic"))
    .mockResolvedValueOnce({ ...report, issues: [] });
  const { rerender } = render(
    <PasswordHealthReportSection
      api={mutationApi({ getPasswordHealthReport })}
      disabled={false}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Run check" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not build");
  fireEvent.click(screen.getByRole("button", { name: "Run check" }));
  await screen.findByText(/No local password-health issues/);
  expect(getPasswordHealthReport).toHaveBeenCalledTimes(2);

  rerender(
    <PasswordHealthReportSection
      api={mutationApi({ getPasswordHealthReport })}
      disabled
    />,
  );
  const button = screen.getByRole("button", { name: "Run again" });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  await waitFor(() => {
    expect(getPasswordHealthReport).toHaveBeenCalledTimes(2);
  });
});
