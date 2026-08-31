import { canonicalGrantedPatterns, siteIdentityFromUrl } from "./site-policy";

describe("site permission policy", () => {
  test.each([
    [
      "https://example.com/login?next=/vault#fragment",
      "https://example.com/*",
      "example.com",
    ],
    ["http://example.com/", "http://example.com/*", "example.com"],
    [
      "https://auth.example.com/",
      "https://auth.example.com/*",
      "auth.example.com",
    ],
    ["http://localhost:8080/login", "http://localhost/*", "localhost"],
    ["http://127.0.0.1:3000/", "http://127.0.0.1/*", "127.0.0.1"],
    ["http://[::1]:3000/", "http://[::1]/*", "[::1]"],
    [
      "https://bücher.example/path",
      "https://xn--bcher-kva.example/*",
      "xn--bcher-kva.example",
    ],
  ])("canonicalizes %s", (input, pattern, host) => {
    expect(siteIdentityFromUrl(input)).toMatchObject({ pattern, host });
  });

  test.each([
    "chrome://settings",
    "edge://settings",
    "about:config",
    "moz-extension://id/popup.html",
    "chrome-extension://id/popup.html",
    "file:///tmp/login.html",
    "view-source:https://example.com/",
    "data:text/html,login",
    "javascript:void(0)",
    "devtools://devtools/",
    "https://user:password@example.com/",
    "not a url",
  ])("rejects unsupported or ambiguous URL %s", (input) => {
    expect(siteIdentityFromUrl(input)).toBeNull();
  });

  test("canonicalizes granted patterns deterministically", () => {
    expect(
      canonicalGrantedPatterns([
        "https://b.example/*",
        "ftp://bad.example/*",
        "https://a.example/*",
        "https://b.example/*",
        "https://*/*",
      ]),
    ).toEqual(["https://*/*", "https://a.example/*", "https://b.example/*"]);
  });
});
