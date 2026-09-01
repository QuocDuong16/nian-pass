import browser from "webextension-polyfill";

import { NATIVE_HOST_NAME } from "./native-identity";
import type { NativePort, NativeRuntime } from "./native-port";
import {
  parseNativeResponse,
  type NativeRequest,
  type NativeResponse,
} from "./native-protocol";
import type { DesktopConnectionState } from "./popup-protocol";

const REQUEST_TIMEOUT_MS = 10_000;
const CONNECTION_APPROVAL_TIMEOUT_MS = 65_000;

interface PendingRequest {
  generation: string;
  kind: "connect" | "candidates" | "credential";
  timer: ReturnType<typeof setTimeout>;
  resolve: (response: NativeResponse) => void;
  reject: () => void;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export class NativeClient {
  #port: NativePort | null = null;
  #generation: string | null = null;
  #state: DesktopConnectionState = "disconnected";
  readonly #pending = new Map<string, PendingRequest>();

  constructor(
    private readonly runtime: NativeRuntime,
    private readonly onDisconnect: () => void,
  ) {}

  get state(): DesktopConnectionState {
    return this.#state;
  }

  get generation(): string | null {
    return this.#generation;
  }

  async connect(): Promise<DesktopConnectionState> {
    if (this.#port !== null) return this.#state;
    let port: NativePort;
    try {
      port = this.runtime.connect(NATIVE_HOST_NAME);
    } catch {
      this.#state = "disconnected";
      return this.#state;
    }
    const generation = randomToken();
    this.#port = port;
    this.#generation = generation;
    this.#state = "waiting";
    port.onMessage.addListener((message) => {
      this.#receive(port, generation, message);
    });
    port.onDisconnect.addListener(() => {
      this.#disconnected(port, generation);
    });
    const response = await this.#request("connect", (requestId) => ({
      version: 1,
      type: "connect",
      requestId,
    }));
    if (response?.type === "connected") {
      this.#state = response.vaultState === "locked" ? "locked" : "ready";
    } else {
      this.#state = "disconnected";
      port.disconnect();
    }
    return this.#state;
  }

  async candidates(origin: string): Promise<NativeResponse | null> {
    if (this.#port === null || this.#generation === null) return null;
    return this.#request("candidates", (requestId) => ({
      version: 1,
      type: "candidates",
      requestId,
      origin,
    }));
  }

  async credential(
    origin: string,
    vaultSessionId: string,
    entryId: string,
  ): Promise<NativeResponse | null> {
    if (this.#port === null || this.#generation === null) return null;
    return this.#request("credential", (requestId) => ({
      version: 1,
      type: "credential",
      requestId,
      origin,
      vaultSessionId,
      entryId,
    }));
  }

  #request(
    kind: PendingRequest["kind"],
    create: (requestId: string) => NativeRequest,
  ): Promise<NativeResponse | null> {
    const port = this.#port;
    const generation = this.#generation;
    if (port === null || generation === null) return Promise.resolve(null);
    const requestId = randomToken();
    return new Promise((resolve) => {
      const timeout =
        kind === "connect"
          ? CONNECTION_APPROVAL_TIMEOUT_MS
          : REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        const pending = this.#pending.get(requestId);
        if (pending?.generation !== generation) return;
        this.#pending.delete(requestId);
        pending.reject();
      }, timeout);
      this.#pending.set(requestId, {
        generation,
        kind,
        timer,
        resolve,
        reject: () => {
          resolve(null);
        },
      });
      try {
        port.postMessage(create(requestId));
      } catch {
        clearTimeout(timer);
        this.#pending.delete(requestId);
        resolve(null);
      }
    });
  }

  #receive(port: NativePort, generation: string, message: unknown): void {
    if (this.#port !== port || this.#generation !== generation) return;
    const response = parseNativeResponse(message);
    if (response === null) {
      port.disconnect();
      return;
    }
    const pending = this.#pending.get(response.requestId);
    if (pending?.generation !== generation) return;
    if (response.type === "approvalPending") {
      if (pending.kind !== "connect") port.disconnect();
      return;
    }
    const expected =
      response.type === "error" ||
      (pending.kind === "connect" && response.type === "connected") ||
      (pending.kind === "candidates" && response.type === "candidates") ||
      (pending.kind === "credential" && response.type === "credential");
    if (!expected) {
      port.disconnect();
      return;
    }
    this.#pending.delete(response.requestId);
    clearTimeout(pending.timer);
    pending.resolve(response);
  }

  #disconnected(port: NativePort, generation: string): void {
    if (this.#port !== port || this.#generation !== generation) return;
    this.#port = null;
    this.#generation = null;
    this.#state = "disconnected";
    for (const [requestId, pending] of this.#pending) {
      if (pending.generation !== generation) continue;
      clearTimeout(pending.timer);
      this.#pending.delete(requestId);
      pending.reject();
    }
    this.onDisconnect();
  }
}

export const nativeRuntime: NativeRuntime = {
  connect(hostName) {
    return browser.runtime.connectNative(hostName);
  },
};
