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

  requirePattern(violations, "README.md", readme, /M5\.3\s*[—-]\s*Android Credential Provider \+ Autofill \+ Keystore/, "current milestone must be M5.3");
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
  requirePattern(violations, "docs/quality.md", quality, /credentials:1\.6\.0[\s\S]{0,500}single-use opaque/i, "M5.3 native dependency and token ratchets are missing");

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
