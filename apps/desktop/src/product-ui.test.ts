import { describe, expect, test } from "vitest";

import css from "./product-ui.css?raw";

describe("desktop product layout", () => {
  test("vault shell remains full-height when optional banners are absent", () => {
    const shell = /\.vault-shell\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const layout = /\.vault-layout\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const status = /\.vault-status-bar\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

    expect(shell).toMatch(/display:\s*flex/);
    expect(shell).toMatch(/flex-direction:\s*column/);
    expect(shell).not.toMatch(/grid-template-rows/);
    expect(layout).toMatch(/flex:\s*1 1 0/);
    expect(layout).toMatch(/min-height:\s*0/);
    expect(status).toMatch(/flex:\s*0 0 24px/);
  });
});
