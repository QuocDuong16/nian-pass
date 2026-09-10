import { browserManifestVersion, generateManifest } from "./manifest";
import { createHash } from "node:crypto";

describe("Manifest V3 generation", () => {
  test("maps source SemVer to monotonic store-safe RC and final versions", () => {
    expect(browserManifestVersion("0.1.0-beta.2")).toBe("0.1.0.20002");
    expect(browserManifestVersion("0.1.0-rc.1")).toBe("0.1.0.30001");
    expect(browserManifestVersion("0.1.0-rc.2")).toBe("0.1.0.30002");
    expect(browserManifestVersion("0.1.0-rc.3")).toBe("0.1.0.30003");
    expect(browserManifestVersion("0.1.0-rc.4")).toBe("0.1.0.30004");
    expect(browserManifestVersion("0.1.0-rc.5")).toBe("0.1.0.30005");
    expect(browserManifestVersion("0.1.0-rc.8")).toBe("0.1.0.30008");
    expect(browserManifestVersion("0.1.0")).toBe("0.1.0.65535");
  });

  test("browser store version mapping fails closed on invalid or unrepresentable input", () => {
    for (const version of ["0.1", "01.1.0", "0.1.0-rc..1"]) {
      expect(() => browserManifestVersion(version)).toThrow(
        "Invalid browser release version",
      );
    }
    expect(() => browserManifestVersion("65536.1.0")).toThrow(
      "component exceeds 65535",
    );
    for (const version of ["0.1.0-rc.0", "0.1.0-rc.10000"]) {
      expect(() => browserManifestVersion(version)).toThrow(
        "sequence must be between 1 and 9999",
      );
    }
  });

  test("generic prerelease identifiers receive a deterministic bounded version", () => {
    const first = browserManifestVersion("1.2.3-preview.7");
    expect(first).toBe(browserManifestVersion("1.2.3-preview.7"));
    expect(first).toMatch(/^1\.2\.3\.[4-6][0-9]{4}$/);
  });

  test("generates a Chromium service worker manifest", () => {
    const manifest = generateManifest("chromium");
    expect(manifest).toMatchObject({
      manifest_version: 3,
      version: "0.1.0.30008",
      version_name: "0.1.0-rc.8",
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
