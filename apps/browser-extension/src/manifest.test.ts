import { generateManifest } from "./manifest";

describe("Manifest V3 generation", () => {
  test("generates a Chromium service worker manifest", () => {
    const manifest = generateManifest("chromium");
    expect(manifest).toMatchObject({
      manifest_version: 3,
      version: "0.1.0",
      permissions: ["activeTab", "scripting"],
      optional_host_permissions: ["http://*/*", "https://*/*"],
      background: { service_worker: "background.js" },
    });
    expect(manifest).not.toHaveProperty("browser_specific_settings");
    expect(JSON.stringify(manifest)).not.toContain("nativeMessaging");
  });

  test("generates a Firefox event background with a neutral ID", () => {
    const manifest = generateManifest("firefox");
    expect(manifest.background).toEqual({
      scripts: ["background.js"],
      persistent: false,
    });
    expect(manifest.browser_specific_settings?.gecko.id).toBe(
      "browser@nian-pass.local",
    );
    expect(manifest.content_security_policy.extension_pages).toContain(
      "connect-src 'none'",
    );
    expect(manifest).not.toHaveProperty("host_permissions");
  });
});
