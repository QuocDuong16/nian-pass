export type BrowserTarget = "chromium" | "firefox";

interface ExtensionManifest {
  manifest_version: 3;
  name: string;
  description: string;
  version: string;
  permissions: string[];
  optional_host_permissions: string[];
  action: { default_popup: string; default_icon: string };
  icons: Record<string, string>;
  content_security_policy: { extension_pages: string };
  background:
    { service_worker: string } | { scripts: string[]; persistent: false };
  browser_specific_settings?: { gecko: { id: string } };
  key?: string;
}

import {
  CHROMIUM_DEVELOPMENT_MANIFEST_KEY,
  FIREFOX_DEVELOPMENT_EXTENSION_ID,
} from "./native-identity.ts";

const sharedManifest = {
  manifest_version: 3 as const,
  name: "Nian Pass",
  description:
    "Explicit per-site credential filling through Nian Pass desktop.",
  version: "0.1.0",
  permissions: ["activeTab", "scripting", "nativeMessaging"],
  optional_host_permissions: ["http://*/*", "https://*/*"],
  action: {
    default_popup: "popup.html",
    default_icon: "icons/icon.png",
  },
  icons: { "512": "icons/icon.png" },
  content_security_policy: {
    extension_pages:
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'",
  },
};

export function generateManifest(target: BrowserTarget): ExtensionManifest {
  if (target === "chromium") {
    return {
      ...sharedManifest,
      background: { service_worker: "background.js" },
      key: CHROMIUM_DEVELOPMENT_MANIFEST_KEY,
    };
  }
  return {
    ...sharedManifest,
    background: { scripts: ["background.js"], persistent: false },
    browser_specific_settings: {
      gecko: { id: FIREFOX_DEVELOPMENT_EXTENSION_ID },
    },
  };
}
