import { vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: { runtime: { connectNative: vi.fn() } },
}));

import { NativeClient } from "./background-native";
import type { NativePort, NativeRuntime } from "./native-port";

class FakeNativePort implements NativePort {
  readonly messages: unknown[] = [];
  readonly #messageListeners: ((message: unknown) => void)[] = [];
  readonly #disconnectListeners: (() => void)[] = [];
  disconnected = false;
  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => {
      this.#messageListeners.push(listener);
    },
  };
  readonly onDisconnect = {
    addListener: (listener: () => void) => {
      this.#disconnectListeners.push(listener);
    },
  };

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  emit(message: unknown): void {
    for (const listener of this.#messageListeners) listener(message);
  }

  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const listener of this.#disconnectListeners) listener();
  }
}

class FakeNativeRuntime implements NativeRuntime {
  readonly ports: FakeNativePort[] = [];

  connect(): FakeNativePort {
    const port = new FakeNativePort();
    this.ports.push(port);
    return port;
  }
}

function requestAt(port: FakeNativePort, index: number) {
  const request = port.messages[index] as {
    type: string;
    requestId: string;
  };
  expect(request.requestId).toMatch(/^[0-9a-f]{32}$/);
  return request;
}

async function connectedClient() {
  const runtime = new FakeNativeRuntime();
  const disconnected = vi.fn();
  const client = new NativeClient(runtime, disconnected);
  const pending = client.connect();
  const port = runtime.ports[0];
  if (port === undefined) throw new Error("native Port was not created");
  const request = requestAt(port, 0);
  port.emit({
    version: 1,
    type: "approvalPending",
    requestId: request.requestId,
  });
  port.emit({
    version: 1,
    type: "connected",
    requestId: request.requestId,
    vaultState: "ready",
  });
  expect(await pending).toBe("ready");
  return { client, runtime, port, disconnected };
}

test("one explicit connect owns one native Port and random connection generation", async () => {
  const { client, runtime, port } = await connectedClient();
  const generation = client.generation;
  expect(generation).toMatch(/^[0-9a-f]{32}$/);
  expect(await client.connect()).toBe("ready");
  expect(runtime.ports).toEqual([port]);
});

test("responses correlate once and duplicate or unknown responses are ignored", async () => {
  const { client, port } = await connectedClient();
  const pending = client.candidates("https://example.com");
  const request = requestAt(port, 1);
  const response = {
    version: 1,
    type: "candidates",
    requestId: request.requestId,
    vaultSessionId: "a".repeat(32),
    candidates: [],
    truncated: false,
  } as const;
  port.emit(response);
  port.emit(response);
  expect(await pending).toEqual(response);
  expect(client.state).toBe("ready");
});

test("disconnect drops pending secret work and a new generation rejects stale responses", async () => {
  const { client, runtime, port, disconnected } = await connectedClient();
  const oldGeneration = client.generation;
  const credential = client.credential(
    "https://example.com",
    "a".repeat(32),
    "entry",
  );
  const oldRequest = requestAt(port, 1);
  port.disconnect();
  expect(await credential).toBeNull();
  expect(disconnected).toHaveBeenCalledOnce();

  const reconnect = client.connect();
  const next = runtime.ports[1];
  if (next === undefined) throw new Error("replacement native Port missing");
  const connectRequest = requestAt(next, 0);
  port.emit({
    version: 1,
    type: "credential",
    requestId: oldRequest.requestId,
    username: "stale",
    password: "stale",
  });
  next.emit({
    version: 1,
    type: "connected",
    requestId: connectRequest.requestId,
    vaultState: "locked",
  });
  expect(await reconnect).toBe("locked");
  expect(client.generation).not.toBe(oldGeneration);
});

test("request timeout clears pending state without a real sleep", async () => {
  vi.useFakeTimers();
  try {
    const { client, port } = await connectedClient();
    const pending = client.candidates("https://example.com");
    requestAt(port, 1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("desktop approval may use its full 60 second window", async () => {
  vi.useFakeTimers();
  try {
    const runtime = new FakeNativeRuntime();
    const client = new NativeClient(runtime, vi.fn());
    const pending = client.connect();
    const port = runtime.ports[0];
    if (port === undefined) throw new Error("native Port was not created");
    requestAt(port, 0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.state).toBe("waiting");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBe("disconnected");
  } finally {
    vi.useRealTimers();
  }
});
