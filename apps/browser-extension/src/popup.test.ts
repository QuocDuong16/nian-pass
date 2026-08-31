import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: false,
  actionOk: true,
  sendMessage: vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: { sendMessage: mocks.sendMessage },
  },
}));

function popupDom(): void {
  document.body.innerHTML =
    '<main><p id="site"></p><p id="permission"></p><p id="detection"></p><button id="enable"></button><button id="disable"></button><p id="error"></p></main>';
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("renders status and handles explicit permission actions with generic failures", async () => {
  popupDom();
  mocks.sendMessage.mockImplementation((message: { type: string }) => {
    if (message.type === "enableSite" || message.type === "disableSite") {
      if (mocks.actionOk) mocks.enabled = message.type === "enableSite";
      return Promise.resolve({
        protocolVersion: 1,
        type: "actionResult",
        ok: mocks.actionOk,
      });
    }
    return Promise.resolve({
      protocolVersion: 1,
      type: "siteStatus",
      site: { host: "example.test", origin: "https://example.test" },
      permission: mocks.enabled ? "enabled" : "disabled",
      detection: mocks.enabled ? "waiting" : "unavailable",
    });
  });
  await import("./popup");
  await settle();
  expect(document.getElementById("site")?.textContent).toBe(
    "Current site: example.test",
  );
  expect(document.getElementById("permission")?.textContent).toBe("Disabled");

  document.getElementById("enable")?.click();
  await vi.waitFor(() => {
    expect(document.getElementById("permission")?.textContent).toBe("Enabled");
  });
  document.getElementById("disable")?.click();
  await vi.waitFor(() => {
    expect(document.getElementById("permission")?.textContent).toBe("Disabled");
  });

  mocks.actionOk = false;
  document.getElementById("enable")?.click();
  await vi.waitFor(() => {
    expect(document.getElementById("error")?.textContent).toBe(
      "Could not enable Nian Pass on this site.",
    );
  });
});
