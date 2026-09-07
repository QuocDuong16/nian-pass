import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const fields = [
  ["Forgejo canonical CI", "FORGEJO_CI_STATUS"],
  ["GitHub release preflight", "PREFLIGHT_STATUS"],
  ["Windows release build", "WINDOWS_BUILD_STATUS"],
  ["Windows native process smoke", "WINDOWS_PROCESS_STATUS"],
  ["Windows full GUI runtime", "WINDOWS_GUI_STATUS"],
  ["Windows Authenticode", "WINDOWS_SIGNING_STATUS"],
  ["Linux AppImage", "LINUX_APPIMAGE_STATUS"],
  ["Linux deb", "LINUX_DEB_STATUS"],
  ["Linux native-host package", "LINUX_NATIVE_PACKAGE_STATUS"],
  ["Linux native process smoke", "LINUX_PROCESS_STATUS"],
  ["Linux full GUI runtime", "LINUX_GUI_STATUS"],
  ["Chromium package", "CHROMIUM_STATUS"],
  ["Firefox package", "FIREFOX_STATUS"],
  ["Browser store signing", "BROWSER_SIGNING_STATUS"],
  ["Android APK", "ANDROID_APK_STATUS"],
  ["Android static security verification", "ANDROID_STATIC_STATUS"],
  ["Android runtime", "ANDROID_RUNTIME_STATUS"],
  ["Android signing", "ANDROID_SIGNING_STATUS"],
  ["Gateway image", "GATEWAY_IMAGE_STATUS"],
  ["Gateway container smoke", "GATEWAY_SMOKE_STATUS"],
  ["Gateway registry publication", "GATEWAY_PUBLISH_STATUS"],
  ["Artifact secret scan", "ARTIFACT_SCAN_STATUS"],
  ["Docker nested-layer scan", "DOCKER_LAYER_SCAN_STATUS"],
  ["SBOM", "SBOM_STATUS"],
  ["Release manifest", "MANIFEST_STATUS"],
  ["SHA256SUMS", "CHECKSUM_STATUS"],
  ["GitHub Release publication", "GITHUB_RELEASE_STATUS"],
];

const allowed = new Set(["PASS", "FAIL", "NOT RUN", "NOT CONFIGURED", "DRAFT"]);

export function releaseStatuses(environment) {
  return Object.fromEntries(fields.map(([label, variable]) => {
    const value = environment[variable] ?? "NOT RUN";
    if (!allowed.has(value)) throw new Error(`${variable} has invalid release status ${value}`);
    return [label, value];
  }));
}

export function releaseStatusMarkdown({ version, tag, commit, statuses }) {
  const width = Math.max(...Object.keys(statuses).map((name) => name.length));
  const rows = Object.entries(statuses).map(([name, value]) => `${name.padEnd(width)}  ${value}`);
  return `# Nian Pass ${version} release validation\n\nExperimental release. Do not use Nian Pass with production credentials.\n\nTag: ${tag}\nCommit: ${commit}\nSupported: Windows desktop, Linux desktop, Android, browser extension, self-hosted Sync Gateway\nApple: M9+ DEFERRED\nKnown limitations: full GUI/device validation, artifact signing, store signing, and registry publication are authoritative only when the matrix below records PASS.\n\n\`\`\`text\n${rows.join("\n")}\n\`\`\`\n`;
}

function main() {
  const version = process.env.RELEASE_VERSION ?? "";
  const tag = process.env.RELEASE_TAG ?? "";
  const commit = process.env.RELEASE_COMMIT ?? "";
  if (!version || tag !== `v${version}` || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("release status requires matching version/tag and a full commit SHA");
  }
  const statuses = releaseStatuses(process.env);
  const output = resolve(process.env.RELEASE_STATUS_OUTPUT ?? "artifacts/release/release-status.md");
  writeFileSync(output, releaseStatusMarkdown({ version, tag, commit, statuses }));
  if (process.env.RELEASE_STATUS_DATA_OUTPUT) {
    writeFileSync(resolve(process.env.RELEASE_STATUS_DATA_OUTPUT), `${JSON.stringify(statuses, null, 2)}\n`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Release status generation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
