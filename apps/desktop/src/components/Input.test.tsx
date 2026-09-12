import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { SearchInput } from "./Input";

afterEach(cleanup);

test("Escape clears search while preserving the caller key handler", () => {
  const onClear = vi.fn();
  const onKeyDown = vi.fn();
  render(
    <SearchInput aria-label="Search" onClear={onClear} onKeyDown={onKeyDown} />,
  );

  const input = screen.getByRole("searchbox", { name: "Search" });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onClear).toHaveBeenCalledOnce();
  expect(onKeyDown).toHaveBeenCalledOnce();

  fireEvent.keyDown(input, { key: "Enter" });
  expect(onClear).toHaveBeenCalledOnce();
  expect(onKeyDown).toHaveBeenCalledTimes(2);
});
