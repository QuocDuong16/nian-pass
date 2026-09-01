import type { BackgroundBrowserApi } from "./browser-api";
import { parseDocumentHello } from "./protocol";
import { CONTENT_PORT_NAME, type RuntimePort } from "./runtime-port";
import { siteIdentityFromUrl } from "./site-policy";

export interface DocumentPortAuthority {
  readonly tabId: number;
  readonly frameId: number;
  readonly origin: string;
  readonly documentNonce: string;
  readonly port: RuntimePort;
}

interface SenderAuthority {
  tabId: number;
  frameId: number;
  origin: string;
  permissionPattern: string;
}

export class BackgroundChannelRegistry {
  readonly #documents = new Map<string, DocumentPortAuthority>();

  constructor(
    private readonly api: BackgroundBrowserApi,
    private readonly onAuthorityChanged: (tabId: number) => void = () =>
      undefined,
  ) {}

  accept(port: RuntimePort): void {
    const sender = this.#senderAuthority(port);
    if (sender === null) {
      port.disconnect();
      return;
    }

    let permissionResolved = false;
    let firstMessageReceived = false;
    let firstMessage: unknown;
    let closed = false;
    port.onMessage.addListener((message) => {
      if (closed) return;
      if (firstMessageReceived) {
        closed = true;
        port.disconnect();
        return;
      }
      firstMessageReceived = true;
      firstMessage = message;
      if (permissionResolved) this.#bind(port, sender, firstMessage);
    });
    port.onDisconnect.addListener(() => {
      closed = true;
      this.#remove(port, sender);
    });

    void this.api
      .containsOrigin(sender.permissionPattern)
      .then((permitted) => {
        if (closed) return;
        if (!permitted) {
          port.disconnect();
          return;
        }
        permissionResolved = true;
        if (firstMessageReceived) this.#bind(port, sender, firstMessage);
      })
      .catch(() => {
        port.disconnect();
      });
  }

  authorityFor(
    tabId: number,
    frameId: number,
    documentNonce: string,
  ): DocumentPortAuthority | null {
    const authority = this.#documents.get(this.#key(tabId, frameId));
    return authority?.documentNonce === documentNonce ? authority : null;
  }

  clearTab(tabId: number): void {
    for (const authority of [...this.#documents.values()]) {
      if (authority.tabId === tabId) this.#retire(authority);
    }
  }

  clearAll(): void {
    for (const authority of [...this.#documents.values()]) {
      this.#retire(authority);
    }
  }

  #senderAuthority(port: RuntimePort): SenderAuthority | null {
    const sender = port.sender;
    const tabId = sender?.tab?.id;
    const frameId = sender?.frameId;
    if (
      port.name !== CONTENT_PORT_NAME ||
      sender?.id !== this.api.extensionId() ||
      tabId === undefined ||
      frameId !== 0 ||
      sender.url === undefined
    ) {
      return null;
    }
    const site = siteIdentityFromUrl(sender.url);
    return site === null
      ? null
      : {
          tabId,
          frameId,
          origin: site.origin,
          permissionPattern: site.pattern,
        };
  }

  #bind(port: RuntimePort, sender: SenderAuthority, message: unknown): void {
    const hello = parseDocumentHello(message);
    if (hello === null) {
      port.disconnect();
      return;
    }
    const key = this.#key(sender.tabId, sender.frameId);
    const previous = this.#documents.get(key);
    if (previous?.port === port) return;
    if (previous !== undefined) this.#retire(previous);
    this.#documents.set(key, {
      tabId: sender.tabId,
      frameId: sender.frameId,
      origin: sender.origin,
      documentNonce: hello.documentNonce,
      port,
    });
    this.onAuthorityChanged(sender.tabId);
  }

  #remove(port: RuntimePort, sender: SenderAuthority): void {
    const key = this.#key(sender.tabId, sender.frameId);
    if (this.#documents.get(key)?.port === port) this.#documents.delete(key);
    this.onAuthorityChanged(sender.tabId);
  }

  #retire(authority: DocumentPortAuthority): void {
    const key = this.#key(authority.tabId, authority.frameId);
    if (this.#documents.get(key)?.port === authority.port) {
      this.#documents.delete(key);
    }
    authority.port.disconnect();
    this.onAuthorityChanged(authority.tabId);
  }

  #key(tabId: number, frameId: number): string {
    return `${tabId.toString()}:${frameId.toString()}`;
  }
}
