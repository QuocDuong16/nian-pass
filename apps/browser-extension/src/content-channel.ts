import {
  PROTOCOL_VERSION,
  parseApplyCredential,
  type ApplyCredential,
} from "./protocol";
import { CONTENT_PORT_NAME, type RuntimePort } from "./runtime-port";

export interface ContentChannelOptions {
  readonly documentNonce: string;
  readonly connect: (name: string) => RuntimePort;
  readonly apply: (command: ApplyCredential) => void;
  readonly isCurrentDocument: () => boolean;
}

export class ContentChannel {
  #port: RuntimePort | null = null;
  #reconnectUsed = false;

  constructor(private readonly options: ContentChannelOptions) {}

  start(): void {
    if (this.#port !== null) return;
    this.#connect();
  }

  #connect(): void {
    const port = this.options.connect(CONTENT_PORT_NAME);
    this.#port = port;
    port.onMessage.addListener((message) => {
      if (this.#port !== port) return;
      const command = parseApplyCredential(message);
      if (command !== null) this.options.apply(command);
    });
    port.onDisconnect.addListener(() => {
      if (this.#port !== port) return;
      this.#port = null;
      if (this.#reconnectUsed || !this.options.isCurrentDocument()) return;
      this.#reconnectUsed = true;
      queueMicrotask(() => {
        if (this.#port === null && this.options.isCurrentDocument()) {
          this.#connect();
        }
      });
    });
    port.postMessage({
      protocolVersion: PROTOCOL_VERSION,
      type: "documentHello",
      documentNonce: this.options.documentNonce,
    });
  }
}
