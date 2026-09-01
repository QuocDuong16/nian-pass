import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: false,
  requestPermission: vi.fn<() => Promise<boolean>>(),
  removePermission: vi.fn<() => Promise<boolean>>(),
  sendMessage: vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: { sendMessage: mocks.sendMessage },
    permissions: {
      request: mocks.requestPermission,
      remove: mocks.removePermission,
    },
  },
}));

function popupDom(): void {
  document.body.innerHTML =
    '<main><p id="site"></p><p id="permission"></p><p id="detection"></p><button id="enable"></button><button id="disable"></button><p id="desktop"></p><button id="connect"></button><div id="candidates"></div><p id="error"></p></main>';
}

async function loadPopup(enabled = false): Promise<void> {
  vi.resetModules();
  mocks.enabled = enabled;
  mocks.requestPermission.mockReset().mockImplementation(async () => {
    mocks.enabled = true;
    return true;
  });
  mocks.removePermission.mockReset().mockImplementation(async () => {
    mocks.enabled = false;
    return true;
  });
  mocks.sendMessage
    .mockReset()
    .mockImplementation((message: { type?: string }) =>
      Promise.resolve(
        message.type === "listCandidates"
          ? {
              protocolVersion: 1,
              type: "browserIntegrationStatus",
              connection: "disconnected",
              candidates: [],
              truncated: false,
              error: "desktopUnavailable",
            }
          : {
              protocolVersion: 1,
              type: "siteStatus",
              site: {
                host: "example.test",
                origin: "https://example.test",
                permissionPattern: "https://example.test/*",
              },
              permission: mocks.enabled ? "enabled" : "disabled",
              detection: mocks.enabled ? "waiting" : "unavailable",
            },
      ),
    );
  popupDom();
  await import("./popup");
  await vi.waitFor(() => {
    expect(document.getElementById("site")?.textContent).toContain(
      "example.test",
    );
  });
}

test("enable click directly requests the preloaded active-site pattern", async () => {
  await loadPopup();
  document.getElementById("enable")?.click();
  expect(mocks.requestPermission).toHaveBeenCalledWith({
    origins: ["https://example.test/*"],
  });
  expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => {
    expect(document.getElementById("permission")?.textContent).toBe("Enabled");
  });
});

test("denied and exceptional enable requests fail generically", async () => {
  await loadPopup();
  mocks.requestPermission.mockResolvedValueOnce(false);
  document.getElementById("enable")?.click();
  await vi.waitFor(() => {
    expect(document.getElementById("error")?.textContent).toBe(
      "Could not enable Nian Pass on this site.",
    );
  });
  expect(document.getElementById("permission")?.textContent).toBe("Disabled");

  mocks.requestPermission.mockRejectedValueOnce(new Error("browser detail"));
  document.getElementById("enable")?.click();
  await vi.waitFor(() => {
    expect(document.getElementById("error")?.textContent).toBe(
      "Could not enable Nian Pass on this site.",
    );
  });
  expect(document.body.textContent).not.toContain("browser detail");

  mocks.requestPermission.mockImplementationOnce(() => {
    throw new Error("synchronous browser detail");
  });
  document.getElementById("enable")?.click();
  expect(document.getElementById("error")?.textContent).toBe(
    "Could not enable Nian Pass on this site.",
  );
  expect(document.body.textContent).not.toContain("synchronous browser detail");
});

test("disable click directly removes the preloaded active-site pattern", async () => {
  await loadPopup(true);
  document.getElementById("disable")?.click();
  expect(mocks.removePermission).toHaveBeenCalledWith({
    origins: ["https://example.test/*"],
  });
  await vi.waitFor(() => {
    expect(document.getElementById("permission")?.textContent).toBe("Disabled");
  });
  mocks.removePermission.mockRejectedValueOnce(new Error("browser detail"));
  document.getElementById("disable")?.click();
  await vi.waitFor(() => {
    expect(document.getElementById("error")?.textContent).toBe(
      "Could not disable Nian Pass on this site.",
    );
  });
});

test("Connect shows waiting, then a secret-free candidate and generic fill result", async () => {
  await loadPopup(true);
  let resolveConnect: (value: unknown) => void = () => undefined;
  const connectPending = new Promise<unknown>((resolve) => {
    resolveConnect = resolve;
  });
  mocks.sendMessage.mockImplementation((message: { type?: string }) => {
    if (message.type === "connectDesktop") return connectPending;
    if (message.type === "listCandidates") {
      return Promise.resolve({
        protocolVersion: 1,
        type: "browserIntegrationStatus",
        connection: "ready",
        candidates: [
          {
            candidateHandle: "a".repeat(32),
            title: { kind: "visible", value: "Example account" },
            username: { kind: "protected" },
          },
        ],
        truncated: false,
        error: null,
      });
    }
    if (message.type === "fillCandidate") {
      return Promise.resolve({
        protocolVersion: 1,
        type: "fillCandidateResult",
        success: true,
      });
    }
    return Promise.resolve({
      protocolVersion: 1,
      type: "siteStatus",
      site: {
        host: "example.test",
        origin: "https://example.test",
        permissionPattern: "https://example.test/*",
      },
      permission: "enabled",
      detection: "detected",
    });
  });
  document.getElementById("connect")?.click();
  expect(document.getElementById("desktop")?.textContent).toBe(
    "Waiting for desktop approval",
  );
  resolveConnect({
    protocolVersion: 1,
    type: "browserIntegrationStatus",
    connection: "ready",
    candidates: [],
    truncated: false,
    error: null,
  });
  await vi.waitFor(() => {
    expect(document.getElementById("candidates")?.textContent).toContain(
      "Example account — Protected",
    );
  });
  const candidate = document.querySelector<HTMLButtonElement>(".candidate");
  if (candidate === null) throw new Error("candidate button missing");
  candidate.click();
  await vi.waitFor(() => {
    expect(document.getElementById("error")?.textContent).toBe(
      "Credential filled. Submit the form when ready.",
    );
  });
  expect(document.body.textContent).not.toContain("synthetic-password");
});

test("connected locked state tells the user to unlock only in desktop", async () => {
  await loadPopup(true);
  mocks.sendMessage.mockImplementation((message: { type?: string }) =>
    Promise.resolve(
      message.type === "getSiteStatus"
        ? {
            protocolVersion: 1,
            type: "siteStatus",
            site: {
              host: "example.test",
              origin: "https://example.test",
              permissionPattern: "https://example.test/*",
            },
            permission: "enabled",
            detection: "detected",
          }
        : {
            protocolVersion: 1,
            type: "browserIntegrationStatus",
            connection: "locked",
            candidates: [],
            truncated: false,
            error: "locked",
          },
    ),
  );
  document.getElementById("connect")?.click();
  await vi.waitFor(() => {
    expect(document.getElementById("desktop")?.textContent).toBe(
      "Vault locked",
    );
    expect(document.getElementById("error")?.textContent).toBe(
      "Unlock your vault in Nian Pass.",
    );
  });
  expect(document.body.querySelector('input[type="password"]')).toBeNull();
});
