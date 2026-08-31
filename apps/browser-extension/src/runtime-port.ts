import type { MessageSender } from "./background-authority";

export const CONTENT_PORT_NAME = "nian-pass-content-v1";

interface PortMessageEvent {
  addListener(listener: (message: unknown) => void): void;
}

interface PortDisconnectEvent {
  addListener(listener: () => void): void;
}

export interface RuntimePort {
  readonly name: string;
  readonly sender?: MessageSender;
  readonly onMessage: PortMessageEvent;
  readonly onDisconnect: PortDisconnectEvent;
  postMessage(message: unknown): void;
  disconnect(): void;
}
