import type {
  ActiveTab,
  BrowserAuthorityApi,
  RegisteredScript,
} from "../browser-api";

export class MockBrowserApi implements BrowserAuthorityApi {
  origins: string[] = [];
  registered: RegisteredScript[] = [];
  activeTab: ActiveTab | null = { id: 7, url: "https://example.com/login" };
  requestAllowed = true;
  removeAllowed = true;
  registerCalls = 0;
  unregisterCalls = 0;

  getAllPermissions(): Promise<{ origins?: string[] }> {
    return Promise.resolve({ origins: [...this.origins] });
  }

  containsOrigin(pattern: string): Promise<boolean> {
    return Promise.resolve(this.origins.includes(pattern));
  }

  requestOrigin(pattern: string): Promise<boolean> {
    if (!this.requestAllowed) return Promise.resolve(false);
    if (!this.origins.includes(pattern)) this.origins.push(pattern);
    return Promise.resolve(true);
  }

  removeOrigin(pattern: string): Promise<boolean> {
    if (!this.removeAllowed) return Promise.resolve(false);
    const before = this.origins.length;
    this.origins = this.origins.filter((origin) => origin !== pattern);
    return Promise.resolve(this.origins.length !== before);
  }

  getRegisteredScripts(id: string): Promise<RegisteredScript[]> {
    return Promise.resolve(
      this.registered.filter((script) => script.id === id),
    );
  }

  unregisterScripts(id: string): Promise<void> {
    this.unregisterCalls += 1;
    this.registered = this.registered.filter((script) => script.id !== id);
    return Promise.resolve();
  }

  registerScript(script: RegisteredScript): Promise<void> {
    this.registerCalls += 1;
    this.registered.push(structuredClone(script));
    return Promise.resolve();
  }

  queryActiveTab(): Promise<ActiveTab | null> {
    return Promise.resolve(this.activeTab);
  }

  extensionId(): string {
    return "nian-pass-test";
  }

  popupUrl(): string {
    return "chrome-extension://nian-pass-test/popup.html";
  }
}
