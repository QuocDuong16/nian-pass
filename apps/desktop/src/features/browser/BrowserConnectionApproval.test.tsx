import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { BrowserApprovalApi } from "../../lib/browser-approval";
import { BrowserConnectionApproval } from "./BrowserConnectionApproval";

test("explicit Allow resolves only the opaque request and hides vault content", async () => {
  const notifier: { current?: (requestId: string) => void } = {};
  const api: BrowserApprovalApi = {
    subscribe(handler) {
      notifier.current = handler;
      return Promise.resolve(() => undefined);
    },
    resolve: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <BrowserConnectionApproval api={api}>
      <button type="button">Synthetic vault action</button>
    </BrowserConnectionApproval>,
  );
  await vi.waitFor(() => {
    expect(notifier.current).toBeDefined();
  });
  notifier.current?.("00112233445566778899aabbccddeeff");
  expect(await screen.findByRole("dialog")).toHaveTextContent(
    "Browser integration connection request",
  );
  expect(screen.getByRole("button", { name: "Allow" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Synthetic vault action" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await vi.waitFor(() => {
    expect(api.resolve).toHaveBeenCalledWith(
      "00112233445566778899aabbccddeeff",
      true,
    );
  });
});

test("Deny is explicit and no vault metadata enters the approval copy", async () => {
  const notifier: { current?: (requestId: string) => void } = {};
  const api: BrowserApprovalApi = {
    subscribe(handler) {
      notifier.current = handler;
      return Promise.resolve(() => undefined);
    },
    resolve: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <BrowserConnectionApproval api={api}>
      <div>SECRET VAULT TITLE</div>
    </BrowserConnectionApproval>,
  );
  await vi.waitFor(() => {
    expect(notifier.current).toBeDefined();
  });
  notifier.current?.("ffeeddccbbaa99887766554433221100");
  const dialog = await screen.findByRole("dialog");
  expect(dialog).not.toHaveTextContent("SECRET VAULT TITLE");
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  await vi.waitFor(() => {
    expect(api.resolve).toHaveBeenCalledWith(
      "ffeeddccbbaa99887766554433221100",
      false,
    );
  });
});
