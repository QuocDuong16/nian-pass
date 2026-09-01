import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..");
const packageRoot = "apps/browser-extension";
const forbiddenPermissions = new Set([
  "tabs",
  "cookies",
  "webRequest",
  "webRequestBlocking",
  "webRequestAuthProvider",
  "clipboardRead",
  "clipboardWrite",
  "notifications",
  "history",
  "downloads",
  "bookmarks",
  "management",
  "unlimitedStorage",
]);
const nativeContract = JSON.parse(
  readFileSync(resolve(repositoryRoot, "browser/native-contract-v1.json"), "utf8"),
);
const secretMarkers = [
  "SECRET_MUST_NOT_BE_READ",
  "M6_ARTIFACT_SECRET_MARKER",
  "correct horse battery staple",
];

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function lineAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function rejectMatches(violations, name, source, pattern, message) {
  for (const match of source.matchAll(pattern)) {
    violations.push(`${name}:${lineAt(source, match.index)}: ${message}`);
  }
}

function requireSource(violations, name, source, pattern, message) {
  if (!pattern.test(source)) violations.push(`${name}: ${message}`);
}

export function runSourceChecks(root) {
  const violations = [];
  const sourceRoot = resolve(root, packageRoot, "src");
  const productionFiles = walk(sourceRoot).filter(
    (path) =>
      /\.(?:ts|css)$/.test(path) &&
      !path.endsWith(".test.ts") &&
      !path.includes("/test/"),
  );
  const sources = new Map(
    productionFiles.map((path) => [
      relative(root, path).replaceAll("\\", "/"),
      readFileSync(path, "utf8"),
    ]),
  );
  for (const [name, source] of sources) {
    if (name.endsWith(".ts") && source.split(/\r?\n/).length > 250) {
      violations.push(`${name}: production TypeScript exceeds the 250-line architecture budget`);
    }
  }
  const combined = [...sources.values()].join("\n");
  const manifest = sources.get(`${packageRoot}/src/manifest.ts`) ?? "";
  const permissions = sources.get(`${packageRoot}/src/permissions.ts`) ?? "";
  const background = sources.get(`${packageRoot}/src/background.ts`) ?? "";
  const backgroundNative = sources.get(`${packageRoot}/src/background-native.ts`) ?? "";
  const authority = sources.get(`${packageRoot}/src/background-authority.ts`) ?? "";
  const backgroundChannel = sources.get(`${packageRoot}/src/background-channel.ts`) ?? "";
  const backgroundApi = sources.get(`${packageRoot}/src/browser-api.ts`) ?? "";
  const content = sources.get(`${packageRoot}/src/content.ts`) ?? "";
  const contentChannel = sources.get(`${packageRoot}/src/content-channel.ts`) ?? "";
  const popup = sources.get(`${packageRoot}/src/popup.ts`) ?? "";
  const popupPermissions = sources.get(`${packageRoot}/src/popup-permissions.ts`) ?? "";
  const nonPopupSources = [...sources]
    .filter(([name]) => !name.endsWith("/popup.ts") && !name.endsWith("/popup-permissions.ts"))
    .map(([, source]) => source)
    .join("\n");
  const detector = [
    sources.get(`${packageRoot}/src/content/detector.ts`) ?? "",
    sources.get(`${packageRoot}/src/content/detection-controller.ts`) ?? "",
  ].join("\n");
  const fields = sources.get(`${packageRoot}/src/content/field-registry.ts`) ?? "";

  requireSource(violations, "manifest.ts", manifest, /manifest_version:\s*3/, "Manifest V3 is required");
  requireSource(violations, "manifest.ts", manifest, /optional_host_permissions:[\s\S]*http:\/\/\*\/\*[\s\S]*https:\/\/\*\/\*/, "optional HTTP(S) host permissions are required");
  rejectMatches(violations, "manifest.ts", manifest, /\bhost_permissions\b/g, "mandatory host permissions are forbidden");
  requireSource(violations, "manifest.ts", manifest, /permissions:\s*\["activeTab",\s*"scripting",\s*"nativeMessaging"\]/, "permissions must include only the reviewed Native Messaging capability");
  requireSource(violations, "background-native.ts", backgroundNative, /\.connect\(NATIVE_HOST_NAME\)/, "background native integration must use the centralized host name");
  requireSource(violations, "background-native.ts", backgroundNative, /runtime\.connectNative\(hostName\)/, "background native integration must own connectNative");
  const connectNativeCalls = [...combined.matchAll(/\.connectNative\s*\(/g)];
  if (connectNativeCalls.length !== 1) {
    violations.push("extension production: exactly one production connectNative call is required");
  }
  for (const [name, source] of sources) {
    if (name !== `${packageRoot}/src/background-native.ts`) {
      rejectMatches(violations, name, source, /\.connectNative\s*\(/g, "connectNative is background-native-only");
    }
  }
  rejectMatches(violations, "extension production", combined, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/g, "network APIs are forbidden");
  rejectMatches(violations, "extension production", combined, /\b(?:localStorage|sessionStorage|indexedDB|storage\.sync|storage\.local)\b/g, "extension storage is not used in M6");
  rejectMatches(violations, "extension production", combined, /\beval\s*\(|\bnew\s+Function\s*\(/g, "dynamic code execution is forbidden");
  rejectMatches(violations, "extension production", combined, /onMessageExternal|onConnectExternal|externally_connectable/g, "external extension messaging is forbidden");
  rejectMatches(violations, "extension production", combined, /eslint-disable/g, "production ESLint disables are forbidden");
  rejectMatches(violations, "extension production", combined, /window\.postMessage|createElement\(["']script["']\)|world:\s*["']MAIN["']/g, "MAIN-world bridges are forbidden");
  rejectMatches(violations, "detector", detector, /\.value\b/g, "form detection must never read field values");
  rejectMatches(violations, "fill primitive", fields, /\.(?:submit|requestSubmit)\s*\(|\.click\s*\(/g, "credential application must never submit");
  requireSource(violations, "permissions.ts", permissions, /registerScript\(/, "dynamic content-script registration policy is required");
  requireSource(violations, "browser-api.ts", combined, /registerContentScripts/, "browser scripting registration API is required");
  requireSource(violations, "permissions.ts", permissions, /allFrames:\s*false/, "dynamic scripts must be top-frame only");
  requireSource(violations, "background.ts", background, /onInstalled[\s\S]*onStartup[\s\S]*permissions\.onAdded[\s\S]*permissions\.onRemoved/, "lifecycle reconciliation listeners must be registered synchronously");
  requireSource(violations, "background-authority.ts", authority, /sender\.frameId\s*!==\s*0/, "content authority must reject non-top frames");
  requireSource(violations, "background-authority.ts", authority, /sender\.id\s*!==\s*this\.api\.extensionId\(\)/, "content authority must require this extension sender ID");
  requireSource(violations, "background-authority.ts", authority, /sender\.url\s*\?\?\s*sender\.tab\?\.url/, "browser sender metadata must own page identity");
  requireSource(violations, "popup-permissions.ts", popupPermissions, /permissions\.request\(\{\s*origins:\s*\[pattern\]/, "popup must directly own optional permission requests");
  requireSource(violations, "popup-permissions.ts", popupPermissions, /permissions\.remove\(\{\s*origins:\s*\[pattern\]/, "popup must directly own optional permission removal");
  rejectMatches(violations, "non-popup production", nonPopupSources, /permissions\.(?:request|remove)\s*\(/g, "optional site permission mutation belongs only to popup production code");
  requireSource(violations, "popup.ts", popup, /enableButton\.addEventListener\([\s\S]{0,500}permissionApi\.requestOrigin\(pattern\)/, "permission request must start inside the popup click handler");
  requireSource(violations, "popup.ts", popup, /disableButton\.addEventListener\([\s\S]{0,500}permissionApi\.removeOrigin\(pattern\)/, "permission removal must start inside the popup click handler");
  rejectMatches(violations, "popup.ts", popup, /\b(?:enableSite|disableSite|applyCredential|usernameFieldHandle|passwordFieldHandle|tabs\.sendMessage)\b/g, "popup must not expose permission delegation or credential delivery");
  rejectMatches(violations, "popup.ts", popup, /\b(?:entryId|password)\b/g, "popup must receive candidate handles and no credential fields");
  requireSource(violations, "content.ts", content, /runtime\.connect\(\{\s*name\s*\}\)/, "content must initiate the fixed internal Port");
  requireSource(violations, "background.ts", background, /runtime\.onConnect\.addListener/, "background must register the Port listener synchronously");
  requireSource(violations, "background-channel.ts", backgroundChannel, /sender\?\.id\s*!==\s*this\.api\.extensionId\(\)/, "Port authority must require this extension sender ID");
  requireSource(violations, "background-channel.ts", backgroundChannel, /frameId\s*!==\s*0/, "Port authority must reject non-top frames");
  requireSource(violations, "background-channel.ts", backgroundChannel, /containsOrigin\(sender\.permissionPattern\)/, "Port authority must require current browser permission");
  requireSource(violations, "content-channel.ts", contentChannel, /parseApplyCredential\(message\)/, "fill commands must use the strict Port protocol parser");
  rejectMatches(violations, "content fill channel", `${content}\n${contentChannel}`, /runtime\.onMessage/g, "content must not accept fill through generic runtime messages");
  return violations;
}

export function scanArtifactText(name, source) {
  return secretMarkers
    .filter((marker) => source.includes(marker))
    .map((marker) => `${name}: forbidden synthetic secret marker ${marker}`);
}

function validateManifest(target, manifest) {
  const violations = [];
  if (manifest.manifest_version !== 3) violations.push(`${target}: manifest_version must be 3`);
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const permission of permissions) {
    if (forbiddenPermissions.has(permission)) violations.push(`${target}: forbidden permission ${permission}`);
  }
  if (permissions.join(",") !== "activeTab,scripting,nativeMessaging") violations.push(`${target}: required permissions must be exactly activeTab,scripting,nativeMessaging`);
  if (manifest.host_permissions !== undefined) violations.push(`${target}: mandatory host_permissions are forbidden`);
  if (JSON.stringify(manifest.optional_host_permissions) !== JSON.stringify(["http://*/*", "https://*/*"])) violations.push(`${target}: optional host permissions must be exact HTTP(S) patterns`);
  const csp = manifest.content_security_policy?.extension_pages;
  if (typeof csp !== "string" || /https?:|unsafe-eval|\*/.test(csp)) violations.push(`${target}: extension CSP permits a remote or unsafe source`);
  if (target === "chromium") {
    if (manifest.background?.service_worker !== "background.js") violations.push("chromium: service_worker is missing");
    if (manifest.background?.scripts !== undefined) violations.push("chromium: background.scripts is forbidden");
    if (manifest.key !== nativeContract.chromiumDevelopment.manifestKey) violations.push("chromium: committed development Manifest key is missing or changed");
  } else {
    if (JSON.stringify(manifest.background?.scripts) !== JSON.stringify(["background.js"])) violations.push("firefox: background.scripts is missing");
    if (manifest.browser_specific_settings?.gecko?.id !== nativeContract.firefoxDevelopmentExtensionId) violations.push("firefox: stable development gecko.id is missing");
    if (manifest.key !== undefined) violations.push("firefox: Chromium Manifest key is forbidden");
  }
  return violations;
}

export function validateArtifacts(root) {
  const violations = [];
  for (const target of ["chromium", "firefox"]) {
    const directory = resolve(root, packageRoot, "dist", target);
    const required = ["manifest.json", "background.js", "content.js", "popup.html", "popup.js", "popup.css", "icons/icon.png"];
    for (const name of required) {
      if (!existsSync(resolve(directory, name))) violations.push(`${target}: missing artifact ${name}`);
    }
    const manifestPath = resolve(directory, "manifest.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      violations.push(...validateManifest(target, manifest));
    }
    if (!existsSync(directory)) continue;
    for (const path of walk(directory).filter((item) => /\.(?:js|json|html|css)$/.test(item))) {
      const name = relative(root, path).replaceAll("\\", "/");
      const source = readFileSync(path, "utf8");
      violations.push(...scanArtifactText(name, source));
      if (target === "chromium" && path.endsWith("background.js") && /\bimport\s*\(/.test(source)) violations.push("chromium: background worker contains a runtime dynamic import");
    }
  }
  return violations;
}

function main() {
  const modes = new Set(process.argv.slice(2));
  const runSource = modes.size === 0 || modes.has("--source");
  const runArtifacts = modes.size === 0 || modes.has("--artifacts");
  const violations = [
    ...(runSource ? runSourceChecks(repositoryRoot) : []),
    ...(runArtifacts ? validateArtifacts(repositoryRoot) : []),
  ];
  if (violations.length === 0) {
    process.stdout.write("Browser extension security and artifact checks passed.\n");
    return;
  }
  process.stderr.write(`Browser extension check failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`);
  process.exitCode = 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
