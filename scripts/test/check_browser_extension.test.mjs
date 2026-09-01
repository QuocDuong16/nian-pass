import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  runSourceChecks,
  scanArtifactText,
  validateArtifacts,
} from "../check_browser_extension.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

test("current browser extension source satisfies security ratchets", () => {
  assert.deepEqual(runSourceChecks(repositoryRoot), []);
});

function sourceFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-browser-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const destination = join(root, "apps/browser-extension/src");
  mkdirSync(destination, { recursive: true });
  cpSync(join(repositoryRoot, "apps/browser-extension/src"), destination, {
    recursive: true,
  });
  return root;
}

test("source ratchet rejects background permission mutation", (t) => {
  const root = sourceFixture(t);
  const path = join(root, "apps/browser-extension/src/background.ts");
  writeFileSync(path, `${readFile(path)}\npermissions.request({ origins: [] });\n`);
  assert.match(
    runSourceChecks(root).join("\n"),
    /permission mutation belongs only to popup/,
  );
});

test("source ratchet rejects generic content fill messaging", (t) => {
  const root = sourceFixture(t);
  const path = join(root, "apps/browser-extension/src/content.ts");
  writeFileSync(path, `${readFile(path)}\nruntime.onMessage;\n`);
  assert.match(runSourceChecks(root).join("\n"), /generic runtime messages/);
});

test("artifact secret scanner rejects exact synthetic markers", () => {
  assert.deepEqual(scanArtifactText("content.js", "ordinary minified symbols"), []);
  assert.match(
    scanArtifactText("content.js", "M6_ARTIFACT_SECRET_MARKER").join("\n"),
    /forbidden synthetic secret marker/,
  );
});

function artifactFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-browser-artifacts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const target of ["chromium", "firefox"]) {
    const directory = join(root, "apps/browser-extension/dist", target);
    mkdirSync(join(directory, "icons"), { recursive: true });
    for (const file of ["background.js", "content.js", "popup.js", "popup.css", "popup.html", "icons/icon.png"]) {
      writeFileSync(join(directory, file), "synthetic artifact\n");
    }
    const manifest = {
      manifest_version: 3,
      permissions: ["activeTab", "scripting", "nativeMessaging"],
      optional_host_permissions: ["http://*/*", "https://*/*"],
      content_security_policy: {
        extension_pages: "default-src 'self'; script-src 'self'; connect-src 'none'",
      },
      background: target === "chromium"
        ? { service_worker: "background.js" }
        : { scripts: ["background.js"], persistent: false },
      ...(target === "firefox"
        ? { browser_specific_settings: { gecko: { id: "browser@nian-pass.local" } } }
        : {
            key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAp0mZzbgUx7NmPGCUdqH63zsgvX1e6K/ZCBv2pcmwQ5cWqPAgrHVHHGvSSJ+4GzQhTlviC6aGyHqwjcxPOuFest9YtubMxsR36k4fGj/wa9swH4rhlBNNikXhbOKOi7qqmxSDuMkBnRn/Zn+Sv5cg2ck2W1IpjfORCGCUoIb5qBqL2HVsHC+58J+kHoSI5JjorjKsOmuavJp/CxlvkAiPNGtks4SlTvqbTvvefZbn8h9wsB42haY1tjlB0ET2HYAx297t43r5PyaNMMuAgKJ+AlikV4NRDV6NqaRlipw9e28N3wQCL9PnqFRQLjbESBpXRN9mPeONivdVNjLGb378wQIDAQAB",
          }),
    };
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  }
  return root;
}

test("valid target-specific MV3 artifacts pass", (t) => {
  assert.deepEqual(validateArtifacts(artifactFixture(t)), []);
});

test("artifact validation rejects permission and background drift", (t) => {
  const root = artifactFixture(t);
  const manifestPath = join(root, "apps/browser-extension/dist/chromium/manifest.json");
  const manifest = JSON.parse(readFile(manifestPath));
  manifest.permissions.push("cookies");
  manifest.host_permissions = ["https://*/*"];
  manifest.background = { scripts: ["background.js"] };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const violations = validateArtifacts(root).join("\n");
  assert.match(violations, /forbidden permission cookies/);
  assert.match(violations, /mandatory host_permissions/);
  assert.match(violations, /service_worker is missing/);
});

function readFile(path) {
  return readFileSync(path, "utf8");
}
