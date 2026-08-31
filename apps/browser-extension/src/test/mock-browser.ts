import type {
  ActiveTab,
  BackgroundBrowserApi,
  RegisteredScript,
} from "../browser-api";

export class MockBrowserApi implements BackgroundBrowserApi {
  origins: string[] = [];
  registered: RegisteredScript[] = [];
  activeTab: ActiveTab | null = { id: 7, url: "https://example.com/login" };
  registerCalls = 0;
  unregisterCalls = 0;

  getAllPermissions(): Promise<{ origins?: string[] }> {
    return Promise.resolve({ origins: [...this.origins] });
  }

  containsOrigin(pattern: string): Promise<boolean> {
    return Promise.resolve(this.origins.includes(pattern));
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
