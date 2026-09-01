import { BackgroundAuthority } from "./background-authority";
import { vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: { runtime: { connectNative: vi.fn() } },
}));
import { BackgroundChannelRegistry } from "./background-channel";
import { NativeClient } from "./background-native";
import { BrowserIntegration } from "./browser-integration";
import type { NativePort, NativeRuntime } from "./native-port";
import { CONTENT_PORT_NAME } from "./runtime-port";
import { MockBrowserApi } from "./test/mock-browser";
import { MockRuntimePort } from "./test/mock-port";

class FakeNativePort implements NativePort {
  readonly messages: unknown[] = [];
  readonly #messages: ((message: unknown) => void)[] = [];
  readonly #disconnects: (() => void)[] = [];
  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => {
      this.#messages.push(listener);
    },
  };
  readonly onDisconnect = {
    addListener: (listener: () => void) => {
      this.#disconnects.push(listener);
    },
  };
  postMessage(message: unknown): void {
    this.messages.push(message);
  }
  emit(message: unknown): void {
    for (const listener of this.#messages) listener(message);
  }
  disconnect(): void {
    for (const listener of this.#disconnects) listener();
  }
}

class FakeRuntime implements NativeRuntime {
  readonly ports: FakeNativePort[] = [];
  connect(): NativePort {
    const port = new FakeNativePort();
    this.ports.push(port);
    return port;
  }
}

const nonceA = "a".repeat(32);
const usernameA = "b".repeat(32);
const passwordA = "c".repeat(32);

async function until(check: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error("condition did not settle");
}

function nativeRequest(port: FakeNativePort, index: number) {
  const request = port.messages[index] as {
    type: string;
    requestId: string;
  };
  expect(request.requestId).toMatch(/^[0-9a-f]{32}$/);
  return request;
}

async function harness() {
  const api = new MockBrowserApi();
  api.origins = ["https://example.com/*"];
  const authority = new BackgroundAuthority(api);
  let integration: BrowserIntegration | null = null;
  const channels = new BackgroundChannelRegistry(api, (tabId) => {
    integration?.clearTab(tabId);
  });
  const content = new MockRuntimePort(CONTENT_PORT_NAME, {
    id: "nian-pass-test",
    frameId: 0,
    url: "https://example.com/login",
    tab: { id: 7, url: "https://example.com/login" },
  });
  channels.accept(content);
  content.emitMessage({
    protocolVersion: 1,
    type: "documentHello",
    documentNonce: nonceA,
  });
  await authority.handleMessage(
    {
      protocolVersion: 1,
      type: "pageStateChanged",
      documentNonce: nonceA,
      hasLoginForm: true,
      passwordFieldCount: 1,
      usernameCandidateCount: 1,
      formCount: 1,
      fillTarget: {
        usernameFieldHandle: usernameA,
        passwordFieldHandle: passwordA,
      },
    },
    {
      id: "nian-pass-test",
      frameId: 0,
      url: "https://example.com/login",
      tab: { id: 7, url: "https://example.com/login" },
    },
  );
  const runtime = new FakeRuntime();
  const native = new NativeClient(runtime, () => integration?.clearAll());
  integration = new BrowserIntegration(authority, channels, native);
  authority.setIntegration(integration);
  const connect = integration.handlePopup({
    protocolVersion: 1,
    type: "connectDesktop",
  });
  const nativePort = runtime.ports[0];
  if (nativePort === undefined) throw new Error("native Port missing");
  const connectRequest = nativeRequest(nativePort, 0);
  nativePort.emit({
    version: 1,
    type: "approvalPending",
    requestId: connectRequest.requestId,
  });
  nativePort.emit({
    version: 1,
    type: "connected",
    requestId: connectRequest.requestId,
    vaultState: "ready",
  });
  await connect;
  return {
    api,
    authority,
    channels,
    content,
    runtime,
    native,
    nativePort,
    integration,
  };
}

async function candidate(h: Awaited<ReturnType<typeof harness>>) {
  const listing = h.integration.handlePopup({
    protocolVersion: 1,
    type: "listCandidates",
  });
  await until(() => h.nativePort.messages.length === 2);
  const request = nativeRequest(h.nativePort, 1);
  h.nativePort.emit({
    version: 1,
    type: "candidates",
    requestId: request.requestId,
    vaultSessionId: "d".repeat(32),
    candidates: [
      {
        entryId: "stable-entry-id",
        title: { kind: "visible", value: "Example" },
        username: { kind: "protected" },
      },
    ],
    truncated: false,
  });
  const status = (await listing) as {
    candidates: { candidateHandle: string }[];
  };
  const handle = status.candidates[0]?.candidateHandle;
  if (handle === undefined) throw new Error("candidate handle missing");
  expect(handle).toMatch(/^[0-9a-f]{32}$/);
  expect(handle).not.toContain("stable-entry-id");
  return handle;
}

async function pendingFill(
  h: Awaited<ReturnType<typeof harness>>,
  handle: string,
) {
  const fill = h.integration.handlePopup({
    protocolVersion: 1,
    type: "fillCandidate",
    candidateHandle: handle,
  });
  await until(() => h.nativePort.messages.length === 3);
  return { fill, request: nativeRequest(h.nativePort, 2) };
}

function credentialResponse(requestId: string) {
  return {
    version: 1,
    type: "credential",
    requestId,
    username: "synthetic-user",
    password: "synthetic-password",
  };
}

test("exact candidate route fills only the current content Port and handle is single-use", async () => {
  const h = await harness();
  const handle = await candidate(h);
  const { fill, request } = await pendingFill(h, handle);
  h.nativePort.emit(credentialResponse(request.requestId));
  h.nativePort.emit(credentialResponse(request.requestId));
  expect(await fill).toMatchObject({ success: true });
  expect(h.content.messages).toHaveLength(1);
  expect(h.content.messages[0]).toMatchObject({
    type: "applyCredential",
    documentNonce: nonceA,
    usernameFieldHandle: usernameA,
    passwordFieldHandle: passwordA,
    username: "synthetic-user",
    password: "synthetic-password",
  });
  expect(
    await h.integration.handlePopup({
      protocolVersion: 1,
      type: "fillCandidate",
      candidateHandle: handle,
    }),
  ).toMatchObject({ success: false });
  expect(h.nativePort.messages).toHaveLength(3);
});

test.each(["navigation", "origin", "permission", "document"])(
  "%s change during native credential request drops the secret",
  async (race) => {
    const h = await harness();
    const handle = await candidate(h);
    const { fill, request } = await pendingFill(h, handle);
    if (race === "navigation") {
      h.authority.clearTab(7);
      h.channels.clearTab(7);
    } else if (race === "origin") {
      h.api.activeTab = { id: 7, url: "https://evil.example/login" };
      h.api.origins.push("https://evil.example/*");
    } else if (race === "permission") {
      h.api.origins = [];
    } else {
      const replacement = new MockRuntimePort(CONTENT_PORT_NAME, {
        id: "nian-pass-test",
        frameId: 0,
        url: "https://example.com/next",
        tab: { id: 7, url: "https://example.com/next" },
      });
      h.channels.accept(replacement);
      replacement.emitMessage({
        protocolVersion: 1,
        type: "documentHello",
        documentNonce: "e".repeat(32),
      });
    }
    h.nativePort.emit(credentialResponse(request.requestId));
    expect(await fill).toMatchObject({ success: false });
    expect(h.content.messages).toHaveLength(0);
  },
);

test("native session replacement drops pending secret and stale response", async () => {
  const h = await harness();
  const handle = await candidate(h);
  const { fill, request } = await pendingFill(h, handle);
  h.nativePort.disconnect();
  expect(await fill).toMatchObject({ success: false });
  const reconnect = h.integration.handlePopup({
    protocolVersion: 1,
    type: "connectDesktop",
  });
  const next = h.runtime.ports[1];
  if (next === undefined) throw new Error("replacement native Port missing");
  const connectRequest = nativeRequest(next, 0);
  h.nativePort.emit(credentialResponse(request.requestId));
  next.emit({
    version: 1,
    type: "connected",
    requestId: connectRequest.requestId,
    vaultState: "ready",
  });
  await reconnect;
  expect(h.content.messages).toHaveLength(0);
});

test("candidate lookup distinguishes disconnected desktop from unavailable page authority", async () => {
  const h = await harness();
  h.nativePort.disconnect();
  expect(
    await h.integration.handlePopup({
      protocolVersion: 1,
      type: "listCandidates",
    }),
  ).toMatchObject({
    connection: "disconnected",
    error: "desktopUnavailable",
  });

  const reconnect = h.integration.handlePopup({
    protocolVersion: 1,
    type: "connectDesktop",
  });
  const next = h.runtime.ports[1];
  if (next === undefined) throw new Error("replacement native Port missing");
  const request = nativeRequest(next, 0);
  next.emit({
    version: 1,
    type: "connected",
    requestId: request.requestId,
    vaultState: "ready",
  });
  await reconnect;
  h.api.origins = [];
  expect(
    await h.integration.handlePopup({
      protocolVersion: 1,
      type: "listCandidates",
    }),
  ).toMatchObject({ error: "unsupportedTarget" });
});

test("a new candidate listing invalidates an older in-flight listing", async () => {
  const h = await harness();
  const first = h.integration.handlePopup({
    protocolVersion: 1,
    type: "listCandidates",
  });
  await until(() => h.nativePort.messages.length === 2);
  const firstRequest = nativeRequest(h.nativePort, 1);
  const second = h.integration.handlePopup({
    protocolVersion: 1,
    type: "listCandidates",
  });
  await until(() => h.nativePort.messages.length === 3);
  const secondRequest = nativeRequest(h.nativePort, 2);
  h.nativePort.emit({
    version: 1,
    type: "candidates",
    requestId: secondRequest.requestId,
    vaultSessionId: "d".repeat(32),
    candidates: [
      {
        entryId: "new-entry",
        title: { kind: "visible", value: "New" },
        username: { kind: "protected" },
      },
    ],
    truncated: false,
  });
  const secondStatus = (await second) as { candidates: unknown[] };
  expect(secondStatus.candidates).toHaveLength(1);
  h.nativePort.emit({
    version: 1,
    type: "candidates",
    requestId: firstRequest.requestId,
    vaultSessionId: "d".repeat(32),
    candidates: [
      {
        entryId: "old-entry",
        title: { kind: "visible", value: "Old" },
        username: { kind: "protected" },
      },
    ],
    truncated: false,
  });
  expect(await first).toMatchObject({ error: "internal", candidates: [] });
});
