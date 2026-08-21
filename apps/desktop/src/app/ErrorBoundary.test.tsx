import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

afterEach(cleanup);

function Failure({ message }: { message: string }): never {
  throw new Error(message);
}

test("unexpected render failure shows the safe recovery screen", () => {
  render(
    <ErrorBoundary>
      <Failure message="ordinary-internal-error" />
    </ErrorBoundary>,
    { onCaughtError: () => undefined },
  );

  expect(screen.getByRole("alert")).toHaveTextContent(
    "The application could not continue.",
  );
  expect(screen.getByText("Close Nian Pass and open it again.")).toBeVisible();
  expect(screen.queryByText("ordinary-internal-error")).not.toBeInTheDocument();
});

test("secret-like exception text is never rendered", () => {
  render(
    <ErrorBoundary>
      <Failure message="super-secret-test-value" />
    </ErrorBoundary>,
    { onCaughtError: () => undefined },
  );

  expect(screen.getByRole("alert")).toBeVisible();
  expect(document.body).not.toHaveTextContent("super-secret-test-value");
});
