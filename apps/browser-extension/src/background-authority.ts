import type { BackgroundBrowserApi } from "./browser-api";
import { PageStatusStore } from "./page-status";
import {
  PROTOCOL_VERSION,
  parsePageStateChanged,
  type PageStateChanged,
} from "./protocol";
import {
  parsePopupMessage,
  type PopupToBackground,
  type SiteStatus,
} from "./popup-protocol";
import { reconcileContentScript } from "./permissions";
import { siteIdentityFromUrl } from "./site-policy";

export interface MessageSender {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}

export interface PopupIntegration {
  handlePopup(
    message: Exclude<PopupToBackground, { type: "getSiteStatus" }>,
  ): Promise<unknown>;
}

export interface ActiveCredentialContext {
  tabId: number;
  origin: string;
  permissionPattern: string;
  documentNonce: string;
  fillTarget: NonNullable<PageStateChanged["fillTarget"]>;
}

export class BackgroundAuthority {
  readonly #status = new PageStatusStore();
  #integration: PopupIntegration | null = null;

  constructor(private readonly api: BackgroundBrowserApi) {}

  setIntegration(integration: PopupIntegration): void {
    this.#integration = integration;
  }

  async handleMessage(
    message: unknown,
    sender: MessageSender,
  ): Promise<unknown> {
    const pageState = parsePageStateChanged(message);
    if (pageState !== null) return this.#acceptPageState(pageState, sender);
    const popupMessage = parsePopupMessage(message);
    if (popupMessage === null || !this.#isPopup(sender)) return undefined;
    if (popupMessage.type === "getSiteStatus") return this.#siteStatus();
    return this.#integration?.handlePopup(popupMessage);
  }

  clearTab(tabId: number): void {
    this.#status.clearTab(tabId);
  }

  clearEphemeralState(): void {
    this.#status.clearAll();
  }

  async reconcile(): Promise<void> {
    await reconcileContentScript(this.api);
  }

  async activeCredentialContext(): Promise<ActiveCredentialContext | null> {
    const site = await this.#activeSite();
    if (site === null || !(await this.api.containsOrigin(site.pattern)))
      return null;
    const page = this.#status.current(site.tabId, site.origin);
    if (page?.fillTarget === null || page === null) return null;
    return {
      tabId: site.tabId,
      origin: site.origin,
      permissionPattern: site.pattern,
      documentNonce: page.documentNonce,
      fillTarget: page.fillTarget,
    };
  }

  async #acceptPageState(
    message: PageStateChanged,
    sender: MessageSender,
  ): Promise<void> {
    const tabId = sender.tab?.id;
    const authoritativeUrl = sender.url ?? sender.tab?.url;
    if (
      sender.id !== this.api.extensionId() ||
      tabId === undefined ||
      sender.frameId !== 0 ||
      authoritativeUrl === undefined
    )
      return;
    const site = siteIdentityFromUrl(authoritativeUrl);
    if (site === null || !(await this.api.containsOrigin(site.pattern))) return;
    this.#status.update(tabId, site.origin, message);
  }

  #isPopup(sender: MessageSender): boolean {
    return (
      sender.id === this.api.extensionId() &&
      sender.url === this.api.popupUrl() &&
      sender.tab === undefined
    );
  }

  async #activeSite(): Promise<{
    tabId: number;
    host: string;
    origin: string;
    pattern: string;
  } | null> {
    const tab = await this.api.queryActiveTab();
    if (tab?.id === undefined || tab.url === undefined) return null;
    const site = siteIdentityFromUrl(tab.url);
    return site === null ? null : { tabId: tab.id, ...site };
  }

  async #siteStatus(): Promise<SiteStatus> {
    const site = await this.#activeSite();
    if (site === null) {
      return {
        protocolVersion: PROTOCOL_VERSION,
        type: "siteStatus",
        site: null,
        permission: "unsupported",
        detection: "unavailable",
      };
    }
    const enabled = await this.api.containsOrigin(site.pattern);
    return {
      protocolVersion: PROTOCOL_VERSION,
      type: "siteStatus",
      site: {
        host: site.host,
        origin: site.origin,
        permissionPattern: site.pattern,
      },
      permission: enabled ? "enabled" : "disabled",
      detection: enabled
        ? this.#status.detection(site.tabId, site.origin)
        : "unavailable",
    };
  }
}
