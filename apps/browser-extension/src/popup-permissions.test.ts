import type browser from "webextension-polyfill";
import { vi } from "vitest";

import { createPopupPermissionApi } from "./popup-permissions";

test("popup adapter owns only direct optional permission mutation", async () => {
  const request = vi.fn().mockResolvedValue(true);
  const remove = vi.fn().mockResolvedValue(true);
  const extension = {
    permissions: { request, remove },
  } as unknown as typeof browser;
  const api = createPopupPermissionApi(extension);

  const requested = api.requestOrigin("https://example.test/*");
  expect(request).toHaveBeenCalledWith({
    origins: ["https://example.test/*"],
  });
  await expect(requested).resolves.toBe(true);

  const removed = api.removeOrigin("https://example.test/*");
  expect(remove).toHaveBeenCalledWith({ origins: ["https://example.test/*"] });
  await expect(removed).resolves.toBe(true);
});
