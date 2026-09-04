import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..");

function readRequired(root, relativePath, violations) {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    violations.push(`${relativePath}: required documentation file is missing`);
    return "";
  }
  return readFileSync(path, "utf8");
}

function requirePattern(violations, path, source, pattern, message) {
  if (!pattern.test(source)) violations.push(`${path}: ${message}`);
}

function workflowJob(source, jobName) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start === -1) return undefined;
  const end = lines.findIndex(
    (line, index) => index > start && /^  [A-Za-z0-9_-]+:\s*$/.test(line),
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

export function runChecks(root) {
  const violations = [];
  const readme = readRequired(root, "README.md", violations);
  const architecture = readRequired(root, "docs/architecture.md", violations);
  const threatModel = readRequired(root, "docs/threat-model.md", violations);
  const writeSafety = readRequired(root, "docs/write-safety.md", violations);
  const quality = readRequired(root, "docs/quality.md", violations);
  const agents = readRequired(root, "AGENTS.md", violations);
  const workflow = readRequired(root, ".forgejo/workflows/quality.yml", violations);
  const packageSource = readRequired(root, "package.json", violations);
  const nodeVersion = readRequired(root, ".node-version", violations).trim();
  const mise = readRequired(root, ".mise.toml", violations);
  const rustToolchain = readRequired(root, "rust-toolchain.toml", violations);
  const makefile = readRequired(root, "Makefile", violations);

  requirePattern(violations, "README.md", readme, /## Current milestone[\s\S]{0,120}M7\s*[—-]\s*BYO-cloud Sync Providers/i, "current milestone must report M7 BYO-cloud sync providers");
  requirePattern(violations, "README.md", readme, /M5\.4\s*[—-]\s*iOS Password AutoFill \+ Keychain[^\n]*DEFERRED/, "roadmap must retain M5.4 deferred");
  requirePattern(violations, "README.md", readme, /M5\.5\s+Android Mobile Security \/ Lifecycle\s+DONE[\s\S]{0,240}M6\s+Browser Extension Foundation\s+DONE[\s\S]{0,240}M6\.5\s+Browser Native Messaging \/ Desktop Integration\s+DONE[\s\S]{0,160}M7\s+BYO-cloud Sync Providers\s+DONE[\s\S]{0,160}M7\.5\s+Self-hosted Sync Gateway\s+NEXT/i, "M7-done and M7.5-next roadmap is missing");
  requirePattern(violations, "README.md", readme, /Desktop explicit sync[\s\S]{0,500}WebDAV[\s\S]{0,500}(?:AWS )?S3[\s\S]{0,800}manual only[\s\S]{0,500}(?:not persisted|never persisted)/i, "M7 provider scope and manual credential policy are missing");
  requirePattern(violations, "docs/architecture.md", architecture, /M7 BYO-cloud sync boundary[\s\S]{0,1400}encrypted remote KDBX bytes \+ opaque RemoteRevision[\s\S]{0,1200}sync-engine[\s\S]{0,800}vault-sync::merge/i, "M7 provider and semantic merge architecture is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /journal[\s\S]{0,800}conditional remote CAS[\s\S]{0,800}BASE last/i, "M7 journal and BASE-last transaction is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /malicious or (?:compromised|broken) provider[\s\S]{0,5000}conditional headers/i, "M7 malicious-provider conditional-header threat is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /credential-chain surprise/i, "M7 AWS credential-chain threat is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /no cryptographic remote[\s\S]{0,180}(?:rollback|conditional-enforcement)/i, "M7 cryptographic remote limitation is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /profile_id[\s\S]{0,200}immutable[\s\S]{0,100}local-source \+ remote-target/i, "M7 profile identity must bind one immutable local and remote relationship");
  requirePattern(violations, "docs/architecture.md", architecture, /malicious or broken server[\s\S]{0,700}cannot always detect/i, "M7 architecture must not overclaim ignored-CAS detection");
  requirePattern(violations, "docs/threat-model.md", threatModel, /successful[\s\S]{0,300}(?:protocol violation|read-back)[\s\S]{0,300}cannot always be detected[\s\S]{0,5000}provider cooperates/i, "M7 threat model must limit CAS guarantees to cooperating providers");
  requirePattern(violations, "docs/quality.md", quality, /sync-source-check[\s\S]{0,200}sync-core-check[\s\S]{0,200}sync-provider-check[\s\S]{0,200}sync-integration-check/i, "M7 focused quality targets are missing");
  requirePattern(violations, "README.md", readme, /Browser integration[\s\S]{0,500}Chromium\/Firefox MV3[\s\S]{0,500}explicit\s+per-site access[\s\S]{0,500}Native Messaging host/i, "M6.5 browser feature boundary is missing");
  requirePattern(violations, "README.md", readme, /exact-document[\s\S]{0,200}never automatically[\s\S]{0,80}submits?/i, "M6.5 exact fill and no-submit boundary is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /M6\.5 browser and desktop credential boundary[\s\S]{0,1600}Native Messaging stdio[\s\S]{0,800}user-local Unix socket or Windows named pipe[\s\S]{0,800}DesktopVaultService[\s\S]{0,600}credential-provider-core/i, "M6.5 browser transport architecture is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /browser host permission[\s\S]{0,300}(?:not|isn't)[\s\S]{0,80}credential identity/i, "browser permission and credential identity separation is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /BrowserBridgeState[\s\S]{0,300}Available[\s\S]{0,120}Unavailable[\s\S]{0,500}(?:does not abort|desktop restart)/i, "optional browser bridge degradation policy is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /Windows[\s\S]{0,300}manifest[\s\S]{0,300}HKCU[\s\S]{0,600}(?:rollback|restores both)/i, "Windows native-host registration transaction is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /web page \/ DOM[\s\S]{0,300}untrusted[\s\S]{0,600}content script[\s\S]{0,300}low-trust[\s\S]{0,600}background extension context[\s\S]{0,300}privileged[\s\S]{0,500}native host[\s\S]{0,300}transport-only/i, "M6.5 browser trust hierarchy is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /same-user local IPC attacker[\s\S]{0,700}desktop approval/i, "M6.5 same-user approval threat is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /fully compromised OS[\s\S]{0,300}root\/Administrator/i, "M6.5 residual OS threats are missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /startup denial of service[\s\S]{0,500}live endpoint conflict[\s\S]{0,500}vault remains[\s\S]{0,100}usable/i, "browser bridge availability threats are missing");
  requirePattern(violations, "docs/quality.md", quality, /browser-source-check[\s\S]{0,300}browser-extension-check[\s\S]{0,300}browser-native-protocol-check[\s\S]{0,300}browser-native-host-check[\s\S]{0,300}browser-integration-check/i, "M6.5 browser quality targets are missing");
  requirePattern(violations, "docs/quality.md", quality, /bridge startup failure[\s\S]{0,500}vault[\s\S]{0,100}usable[\s\S]{0,800}Windows[\s\S]{0,800}rollback/i, "M6.5 remediation regression policy is missing");
  requirePattern(violations, "docs/quality.md", quality, /do not[\s\S]{0,80}(?:require|launch)[\s\S]{0,120}(?:Chrome|Chromium)[\s\S]{0,120}Firefox/i, "M6 browser no-GUI policy is missing");
  requirePattern(violations, "README.md", readme, /read-only providers[\s\S]{0,160}(?:editing|Save) disabled/i, "M5.2 read-only provider boundary is missing");
  requirePattern(violations, "README.md", readme, /AtomicFile[\s\S]{0,300}save_uncertain[\s\S]{0,160}recovery_required/i, "M5.2 recovery and uncertainty boundary is missing");
  requirePattern(violations, "README.md", readme, /explicit Save/i, "M4.4 explicit Save UX is missing");
  requirePattern(violations, "README.md", readme, /external[\s\S]{0,180}(?:refus|not automatically merged)/i, "M4.4 external-conflict boundary is missing");
  requirePattern(violations, "README.md", readme, /no Save As[\s\S]{0,100}(?:force overwrite|autosave)/i, "M4.4 persistence non-goals are missing");
  requirePattern(violations, "docs/architecture.md", architecture, /M4\.Q/, "architecture must describe M4.Q");
  requirePattern(violations, "README.md", readme, /make quality-check/, "canonical quality command is missing");
  requirePattern(violations, "README.md", readme, /Headless Linux/i, "headless desktop development guidance is missing");
  requirePattern(violations, "README.md", readme, /Windows[\s\S]{0,240}(?:deferred|fails closed|unsupported)/i, "Windows persistence deferral is missing");
  requirePattern(violations, "docs/write-safety.md", writeSafety, /Windows[\s\S]{0,240}(?:fails closed|unsupported)/i, "Windows write safety deferral is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /supply-chain dependencies/i, "dependency threat is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /clipboard history/i, "clipboard history limitation is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /salt[\s\S]{0,160}SHA-256[\s\S]{0,160}generation/i, "clipboard ownership architecture is missing");
  requirePattern(violations, "README.md", readme, /clipboard[\s\S]{0,180}only if[\s\S]{0,180}written by Nian Pass/i, "conditional clipboard clearing is missing");
  requirePattern(violations, "README.md", readme, /privacy shield[\s\S]{0,300}(?:not|isn't)[\s\S]{0,80}screenshot/i, "M4.5 privacy-shield limitation is missing");
  requirePattern(violations, "README.md", readme, /timeout[\s\S]{0,160}(?:application-)?memory only/i, "M4.5 memory-only timeout setting is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /dirty[\s\S]{0,120}timeout[\s\S]{0,240}(?:never|explicit)[\s\S]{0,100}discard/i, "M4.5 dirty-idle non-discard control is missing");
  requirePattern(violations, "AGENTS.md", agents, /Do not hand-edit generated OpenWiki pages/i, "generated OpenWiki ownership rule is missing");
  requirePattern(violations, "README.md", readme, /Android 8\.0[\s\S]{0,80}API 26/i, "Android API 26 minimum is missing");
  requirePattern(violations, "README.md", readme, /make mobile-android-check/, "real Android build gate is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /apps\/desktop[\s\S]{0,180}historical/i, "shared Tauri host naming debt is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /content:\/\/[\s\S]{0,400}opaque source token[\s\S]{0,240}encrypted generation baseline/i, "Android URI persistence boundary is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /VaultSession`? is NOT used[\s\S]{0,240}never owns a URI[\s\S]{0,120}(?:canonical provider path|fake canonical)/i, "Android staging must exclude VaultSession");
  requirePattern(violations, "docs/architecture.md", architecture, /residual[\s\S]{0,160}writer race[\s\S]{0,240}cannot prove/i, "Android provider race limitation is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /iOS[\s\S]{0,180}(?:NOT RUN|not initialized|not.*built)[\s\S]{0,180}macOS with Xcode/i, "honest iOS validation boundary is missing");
  requirePattern(violations, "docs/quality.md", quality, /mobile-tools-check[\s\S]{0,300}mobile-android-check/i, "mobile gate policy is missing");
  requirePattern(violations, "README.md", readme, /CredentialProviderService[\s\S]{0,160}API 34[\s\S]{0,200}AutofillService[\s\S]{0,160}API 26/i, "M5.3 Android credential surfaces are missing");
  requirePattern(violations, "README.md", readme, /explicit opt-in[\s\S]{0,500}AES-256-GCM[\s\S]{0,500}master password again/i, "M5.3 source remembering boundary is missing");
  requirePattern(violations, "README.md", readme, /package[\s\S]{0,100}SHA-256 signing-certificate pin[\s\S]{0,220}explicit confirmation/i, "M5.3 signing trust policy is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /Android OS request[\s\S]{0,500}opaque request token[\s\S]{0,600}backend-only native final result/i, "M5.3 credential fulfillment architecture is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /Keystore[\s\S]{0,260}source bookmark[\s\S]{0,400}no master password[\s\S]{0,160}derived key/i, "M5.3 Keystore non-secret boundary is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /fake Android application[\s\S]{0,500}signing key[\s\S]{0,500}unverified[\s\S]{0,500}request token/i, "M5.3 credential threats are missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /setUserAuthenticationRequired\(false\)[\s\S]{0,700}no master password/i, "M5.3 metadata-key policy is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /M5\.5[\s\S]{0,1800}FLAG_SECURE[\s\S]{0,700}setRecentsScreenshotEnabled\(false\)[\s\S]{0,1200}curtain/i, "M5.5 secure-window and privacy-curtain architecture is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /SystemClock\.elapsedRealtime\(\)[\s\S]{0,1000}generation[\s\S]{0,1500}safe-UI[\s\S]{0,30}acknowledgement/i, "M5.5 monotonic resume handshake is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /processForeground[\s\S]{0,120}screen state[\s\S]{0,240}activityResumed[\s\S]{0,100}windowFocused[\s\S]{0,700}ProcessLifecycleOwner[\s\S]{0,300}not the immediate[\s\S]{0,500}MainActivity[\s\S]{0,100}CredentialActivity[\s\S]{0,100}cannot/i, "M5.5 per-Activity authority and delayed process-lifecycle boundary are missing");
  requirePattern(violations, "docs/architecture.md", architecture, /PowerManager\.isInteractive[\s\S]{0,300}KeyguardManager\.isDeviceLocked/i, "M5.5 interactive-first screen classifier is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /dirty[\s\S]{0,700}(?:never autosaves|never[^\n]*discards)/i, "M5.5 dirty and draft decision path is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /Security attention[\s\S]{0,300}(?:Save|reload)[\s\S]{0,400}(?:in-flight|continues)[\s\S]{0,160}(?:reconciled|cancelled)/i, "M5.5 security dialog precedence is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /FLAG_SECURE[\s\S]{0,1000}(?:root|compromised OS)[\s\S]{0,4000}wall-clock rollback/i, "M5.5 screen and monotonic-time limitations are missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /process death[\s\S]{0,900}unsaved[\s\S]{0,500}(?:plaintext|decrypted) recovery/i, "M5.5 dirty process-death limitation is missing");
  requirePattern(violations, "docs/quality.md", quality, /M5\.5[\s\S]{0,1200}SystemClock\.elapsedRealtime[\s\S]{0,3000}instrumentation[\s\S]{0,500}only compiles/i, "M5.5 lifecycle ratchets and device-test boundary are missing");
  requirePattern(violations, "docs/quality.md", quality, /PowerManager\.isInteractive[\s\S]{0,4000}(?:same-process|Lock\/unlock)[\s\S]{0,300}(?:new-root|new app)/i, "M5.5 screen and process-memory timeout regressions are missing");
  requirePattern(violations, "docs/quality.md", quality, /credentials:1\.6\.0[\s\S]{0,500}single-use opaque/i, "M5.3 native dependency and token ratchets are missing");
  requirePattern(violations, "docs/architecture.md", architecture, /populated origin[\s\S]{0,160}unavailable[\s\S]{0,500}isOriginPopulated\(\)[\s\S]{0,200}getOrigin\(privilegedAllowlist\)/i, "M5.3 verified Credential Manager origin policy is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /retrieveBeginGetCredentialRequest\(\)[\s\S]{0,220}retrieveProviderGetCredentialRequest\(\)[\s\S]{0,500}process restart/i, "M5.3 framework request reconstruction is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /READ-only SAF flag[\s\S]{0,1000}READ=yes[\s\S]{0,80}WRITE=no/i, "M5.3 READ-only remembered grant policy is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /confused deputy[\s\S]{0,600}process death[\s\S]{0,500}PendingIntent[\s\S]{0,500}singleTop/i, "M5.3 origin and process-death threats are missing");
  requirePattern(violations, "docs/architecture.md", architecture, /UIDocumentPickerViewController[\s\S]{0,500}NSFileCoordinator[\s\S]{0,800}encrypted App Group mirror/i, "M5.4 iOS host and mirror boundary is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /Host-only access group[\s\S]{0,500}Keychain NEVER[\s\S]{0,160}master password/i, "M5.4 Keychain separation is missing");
  requirePattern(violations, "docs/architecture.md", architecture, /np_ios_open_vault[\s\S]{0,900}panic/i, "M5.4 FFI ownership and panic boundary is missing");
  requirePattern(violations, "docs/threat-model.md", threatModel, /separate short-lived process[\s\S]{0,1800}size[\s\S]{0,120}SHA-256[\s\S]{0,1800}identity/i, "M5.4 extension, mirror, and identity threats are missing");
  requirePattern(violations, "docs/quality.md", quality, /mobile-ios-tools-check[\s\S]{0,700}mobile-ios-check[\s\S]{0,700}embedded `?\.appex/i, "M5.4 macOS build gate policy is missing");

  const qualityRequirements = [
    [/ratchet/i, "coverage ratchet policy is missing"],
    [/lowering[\s\S]{0,120}(?:architecture|security)/i, "threshold reduction policy is missing"],
    [/eslint-disable/i, "ESLint disable policy is missing"],
    [/unsafe_code\s*=\s*forbid/i, "unsafe Rust policy is missing"],
    [/exact path/i, "exact-path exception policy is missing"],
    [/cargo-deny/i, "Rust dependency policy is missing"],
    [/pnpm audit --prod/i, "frontend production audit policy is missing"],
    [/navigator\.clipboard/i, "browser clipboard ban is missing"],
    [/clipboard-manager[\s\S]{0,160}apps\/desktop\/src-tauri/i, "Rust clipboard allowlist is missing"],
    [/OpenWiki[\s\S]{0,500}(?:not|isn't)[\s\S]{0,40}source of[\s\S]{0,10}truth/i, "OpenWiki source-of-truth policy is missing"],
  ];
  for (const [pattern, message] of qualityRequirements) {
    requirePattern(violations, "docs/quality.md", quality, pattern, message);
  }

  let packageJson = {};
  try {
    packageJson = JSON.parse(packageSource);
  } catch {
    violations.push("package.json: invalid JSON");
  }
  const declaredNode = packageJson.engines?.node;
  const packageManager = packageJson.packageManager;
  if (declaredNode !== nodeVersion || !/^\d+\.\d+\.\d+$/.test(nodeVersion)) {
    violations.push(".node-version and package.json engines.node must contain the same exact version");
  }
  if (nodeVersion !== "" && !workflow.includes(nodeVersion)) {
    violations.push(`.forgejo/workflows/quality.yml: pinned Node ${nodeVersion} is not reused`);
  }
  const rustVersion = mise.match(/^rust\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m)?.[1];
  if (rustVersion === undefined) {
    violations.push(".mise.toml: Rust must be pinned to an exact version");
  } else {
    if (!rustToolchain.includes(`channel = "${rustVersion}"`)) {
      violations.push(`rust-toolchain.toml: must mirror mise Rust ${rustVersion}`);
    }
    if (!makefile.includes("RUST_VERSION := $(shell") || !makefile.includes(".mise.toml")) {
      violations.push("Makefile: RUST_VERSION must be sourced from .mise.toml");
    }
    if (!workflow.includes(`rust:${rustVersion}-bookworm`)) {
      violations.push(`.forgejo/workflows/quality.yml: pinned Rust ${rustVersion} is not reused`);
    }
    if (!quality.includes(`Rust ${rustVersion}`)) {
      violations.push(`docs/quality.md: pinned Rust ${rustVersion} is not documented`);
    }
  }
  const corepackVersion = quality.match(/\bCorepack\s+(\d+\.\d+\.\d+)\b/i)?.[1];
  if (corepackVersion === undefined) {
    violations.push("docs/quality.md: Corepack must be pinned explicitly for Node 26");
  } else if (!workflow.includes(`npm install --global corepack@${corepackVersion}`)) {
    violations.push(
      `.forgejo/workflows/quality.yml: pinned Corepack ${corepackVersion} must be installed explicitly`,
    );
  }
  const pnpmVersion =
    typeof packageManager === "string" ? packageManager.match(/^pnpm@(\d+\.\d+\.\d+)$/)?.[1] : undefined;
  if (pnpmVersion === undefined) {
    violations.push("package.json: packageManager must pin an exact pnpm version");
  } else if (!workflow.includes(`pnpm@${pnpmVersion}`)) {
    violations.push(`.forgejo/workflows/quality.yml: pinned pnpm ${pnpmVersion} is not reused`);
  }

  const desktopFrontendJob = workflowJob(workflow, "desktop-frontend");
  const desktopNativeJob = workflowJob(workflow, "desktop-native-check");
  if (desktopFrontendJob === undefined) {
    violations.push(".forgejo/workflows/quality.yml: desktop-frontend job is missing");
  } else if (desktopFrontendJob.includes("browser-integration-check")) {
    violations.push(
      ".forgejo/workflows/quality.yml: browser-integration-check must not run in the Node-only desktop-frontend job",
    );
  }
  if (desktopNativeJob === undefined) {
    violations.push(".forgejo/workflows/quality.yml: desktop-native-check job is missing");
  } else {
    if (!desktopNativeJob.includes("browser-integration-check")) {
      violations.push(
        ".forgejo/workflows/quality.yml: desktop-native-check must own browser-integration-check",
      );
    }
    if (
      corepackVersion !== undefined &&
      !desktopNativeJob.includes(`npm install --global corepack@${corepackVersion}`)
    ) {
      violations.push(
        `.forgejo/workflows/quality.yml: desktop-native-check must install pinned Corepack ${corepackVersion}`,
      );
    }
    if (pnpmVersion !== undefined && !desktopNativeJob.includes(`pnpm@${pnpmVersion}`)) {
      violations.push(
        `.forgejo/workflows/quality.yml: desktop-native-check must activate pinned pnpm ${pnpmVersion}`,
      );
    }
  }

  return violations;
}

function main() {
  const violations = runChecks(repositoryRoot);
  if (violations.length > 0) {
    process.stderr.write(
      `Documentation check failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("Documentation check passed.\n");
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
