import { vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    permissions: {},
    scripting: {},
    tabs: {},
    runtime: {},
  },
}));

test("creates the production adapter from the bundled polyfill", async () => {
  const binding = await import("./browser-binding");
  expect(binding.browserApi).toBeDefined();
});
