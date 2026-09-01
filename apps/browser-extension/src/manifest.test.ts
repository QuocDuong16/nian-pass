import { generateManifest } from "./manifest";
import { createHash } from "node:crypto";

describe("Manifest V3 generation", () => {
  test("generates a Chromium service worker manifest", () => {
    const manifest = generateManifest("chromium");
    expect(manifest).toMatchObject({
      manifest_version: 3,
      version: "0.1.0",
      permissions: ["activeTab", "scripting", "nativeMessaging"],
      optional_host_permissions: ["http://*/*", "https://*/*"],
      background: { service_worker: "background.js" },
    });
    expect(manifest).not.toHaveProperty("browser_specific_settings");
    expect(manifest.key).toBeDefined();
    const digest = createHash("sha256")
      .update(Buffer.from(manifest.key ?? "", "base64"))
      .digest()
      .subarray(0, 16)
      .toString("hex");
    const developmentId = Array.from(digest)
      .map((character) =>
        String.fromCharCode("a".charCodeAt(0) + Number.parseInt(character, 16)),
      )
      .join("");
    expect(developmentId).toBe("hikglhjadglkpicocjdjipeifnemoplg");
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
