import type { MessageSender } from "../background-authority";
import type { RuntimePort } from "../runtime-port";

export class MockRuntimePort implements RuntimePort {
  readonly messages: unknown[] = [];
  readonly #messageListeners: ((message: unknown) => void)[] = [];
  readonly #disconnectListeners: (() => void)[] = [];
  #peer: MockRuntimePort | null = null;
  disconnected = false;
  readonly name: string;
  readonly sender?: MessageSender;
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

  constructor(name: string, sender?: MessageSender) {
    this.name = name;
    if (sender !== undefined) this.sender = sender;
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
    this.#peer?.emitMessage(message);
  }

  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const listener of this.#disconnectListeners) listener();
    if (this.#peer !== null) this.#peer.#disconnectFromPeer();
  }

  emitMessage(message: unknown): void {
    for (const listener of this.#messageListeners) listener(message);
  }

  link(peer: MockRuntimePort): void {
    this.#peer = peer;
    peer.#peer = this;
  }

  #disconnectFromPeer(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const listener of this.#disconnectListeners) listener();
  }
}
