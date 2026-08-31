import type Browser from "webextension-polyfill";

export interface ActiveTab {
  id?: number;
  url?: string;
}

export interface RegisteredScript {
  id: string;
  matches?: string[];
  js?: string[];
  allFrames?: boolean;
  runAt?: "document_start" | "document_end" | "document_idle";
}

export interface BrowserAuthorityApi {
  getAllPermissions(): Promise<{ origins?: string[] }>;
  containsOrigin(pattern: string): Promise<boolean>;
  requestOrigin(pattern: string): Promise<boolean>;
  removeOrigin(pattern: string): Promise<boolean>;
  getRegisteredScripts(id: string): Promise<RegisteredScript[]>;
  unregisterScripts(id: string): Promise<void>;
  registerScript(script: RegisteredScript): Promise<void>;
  queryActiveTab(): Promise<ActiveTab | null>;
  extensionId(): string;
  popupUrl(): string;
}

export function createBrowserApi(
  webExtension: typeof Browser,
): BrowserAuthorityApi {
  return {
    async getAllPermissions() {
      return webExtension.permissions.getAll();
    },
    async containsOrigin(pattern) {
      return webExtension.permissions.contains({ origins: [pattern] });
    },
    async requestOrigin(pattern) {
      return webExtension.permissions.request({ origins: [pattern] });
    },
    async removeOrigin(pattern) {
      return webExtension.permissions.remove({ origins: [pattern] });
    },
    async getRegisteredScripts(id) {
      return webExtension.scripting.getRegisteredContentScripts({ ids: [id] });
    },
    async unregisterScripts(id) {
      await webExtension.scripting.unregisterContentScripts({ ids: [id] });
    },
    async registerScript(script) {
      await webExtension.scripting.registerContentScripts([script]);
    },
    async queryActiveTab() {
      const [tab] = await webExtension.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab ?? null;
    },
    extensionId() {
      return webExtension.runtime.id;
    },
    popupUrl() {
      return webExtension.runtime.getURL("popup.html");
    },
  };
}
