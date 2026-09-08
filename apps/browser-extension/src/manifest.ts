export type BrowserTarget = "chromium" | "firefox";

interface ExtensionManifest {
  manifest_version: 3;
  name: string;
  description: string;
  version: string;
  version_name: string;
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
import packageMetadata from "../package.json" with { type: "json" };

const releaseVersion = packageMetadata.version;
const prereleaseChannelBase: Readonly<Record<string, number | undefined>> = {
  alpha: 10_000,
  beta: 20_000,
  rc: 30_000,
};

function isAsciiAlphanumeric(value: string): boolean {
  if (value.length === 0) return false;
  return Array.from(value).every((character) => {
    const code = character.codePointAt(0) ?? -1;
    return (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    );
  });
}

function isAsciiDigits(value: string): boolean {
  return (
    value.length > 0 &&
    Array.from(value).every((character) => character >= "0" && character <= "9")
  );
}

export function browserManifestVersion(version: string): string {
  const separator = version.indexOf("-");
  const core = separator === -1 ? version : version.slice(0, separator);
  const suffix = separator === -1 ? undefined : version.slice(separator + 1);
  const numericText = core.split(".");
  const suffixSegments = suffix?.replaceAll("-", ".").split(".") ?? [];
  if (
    numericText.length !== 3 ||
    numericText.some(
      (part) =>
        !isAsciiDigits(part) || (part.length > 1 && part.startsWith("0")),
    ) ||
    (suffix !== undefined &&
      suffixSegments.some((part) => !isAsciiAlphanumeric(part)))
  ) {
    throw new Error(`Invalid browser release version ${version}`);
  }
  const numeric = numericText.map(Number);
  if (numeric.some((part) => part > 65_535)) {
    throw new Error(
      `Browser release version component exceeds 65535: ${version}`,
    );
  }
  if (!suffix) return `${numeric.join(".")}.65535`;

  const ordered = suffix.split(".");
  const channelBase = prereleaseChannelBase[ordered[0] ?? ""];
  if (
    ordered.length === 2 &&
    channelBase !== undefined &&
    isAsciiDigits(ordered[1] ?? "")
  ) {
    const sequence = Number(ordered[1]);
    if (sequence < 1 || sequence > 9_999) {
      throw new Error(
        `Browser prerelease sequence must be between 1 and 9999: ${version}`,
      );
    }
    return `${numeric.join(".")}.${String(channelBase + sequence)}`;
  }

  let hash = 0x811c9dc5;
  for (const character of suffix) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${numeric.join(".")}.${String(40_000 + (hash % 25_535))}`;
}

const sharedManifest = {
  manifest_version: 3 as const,
  name: "Nian Pass",
  description:
    "Explicit per-site credential filling through Nian Pass desktop.",
  version: browserManifestVersion(releaseVersion),
  version_name: releaseVersion,
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
