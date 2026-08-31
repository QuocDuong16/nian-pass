export interface SiteIdentity {
  host: string;
  origin: string;
  pattern: string;
}

const supportedSchemes = new Set(["http:", "https:"]);

export function siteIdentityFromUrl(value: string): SiteIdentity | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    !supportedSchemes.has(url.protocol) ||
    url.hostname === "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }
  return {
    host: url.hostname,
    origin: url.origin,
    pattern: `${url.protocol}//${url.hostname}/*`,
  };
}

export function canonicalGrantedPatterns(origins: readonly string[]): string[] {
  const patterns = origins.filter((origin) => {
    if (origin === "http://*/*" || origin === "https://*/*") return true;
    return /^(?:http|https):\/\/(?:\[[0-9a-fA-F:]+\]|[^/*]+)\/\*$/.test(origin);
  });
  return [...new Set(patterns)].sort();
}
