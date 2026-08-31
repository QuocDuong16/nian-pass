import type { BrowserAuthorityApi } from "./browser-api";
import { PageStatusStore } from "./page-status";
import {
  PROTOCOL_VERSION,
  parsePageStateChanged,
  parsePopupMessage,
  type ActionResult,
  type PageStateChanged,
  type SiteStatus,
} from "./protocol";
import { reconcileContentScript } from "./permissions";
import { siteIdentityFromUrl } from "./site-policy";

export interface MessageSender {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}

export class BackgroundAuthority {
  readonly #status = new PageStatusStore();

  constructor(private readonly api: BrowserAuthorityApi) {}

  async handleMessage(
    message: unknown,
    sender: MessageSender,
  ): Promise<unknown> {
    const pageState = parsePageStateChanged(message);
    if (pageState !== null) return this.#acceptPageState(pageState, sender);
    const popupMessage = parsePopupMessage(message);
    if (popupMessage === null || !this.#isPopup(sender)) return undefined;
    if (popupMessage.type === "getSiteStatus") return this.#siteStatus();
    return this.#changePermission(popupMessage.type === "enableSite");
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

  async #acceptPageState(
    message: PageStateChanged,
    sender: MessageSender,
  ): Promise<ActionResult | undefined> {
    const tabId = sender.tab?.id;
    const authoritativeUrl = sender.url ?? sender.tab?.url;
    if (
      sender.id !== this.api.extensionId() ||
      tabId === undefined ||
      sender.frameId !== 0 ||
      authoritativeUrl === undefined
    )
      return undefined;
    const site = siteIdentityFromUrl(authoritativeUrl);
    if (site === null || !(await this.api.containsOrigin(site.pattern)))
      return undefined;
    this.#status.update(tabId, site.origin, message);
    return {
      protocolVersion: PROTOCOL_VERSION,
      type: "actionResult",
      ok: true,
    };
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
      site: { host: site.host, origin: site.origin },
      permission: enabled ? "enabled" : "disabled",
      detection: enabled
        ? this.#status.detection(site.tabId, site.origin)
        : "unavailable",
    };
  }

  async #changePermission(enable: boolean): Promise<ActionResult> {
    const site = await this.#activeSite();
    if (site === null)
      return {
        protocolVersion: PROTOCOL_VERSION,
        type: "actionResult",
        ok: false,
      };
    try {
      const changed = enable
        ? await this.api.requestOrigin(site.pattern)
        : await this.api.removeOrigin(site.pattern);
      await this.reconcile();
      if (!enable) {
        this.#status.clearOrigin(site.origin);
        this.#status.clearTab(site.tabId);
      }
      const expected = enable;
      const actual = await this.api.containsOrigin(site.pattern);
      return {
        protocolVersion: PROTOCOL_VERSION,
        type: "actionResult",
        ok: (changed || actual === expected) && actual === expected,
      };
    } catch {
      return {
        protocolVersion: PROTOCOL_VERSION,
        type: "actionResult",
        ok: false,
      };
    }
  }
}
