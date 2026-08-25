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

  requirePattern(violations, "README.md", readme, /M4\.4\s*[—-]\s*Desktop Save \/ External Modification \/ Conflict UX/, "current milestone must be M4.4");
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
  requirePattern(violations, "AGENTS.md", agents, /Do not hand-edit generated OpenWiki pages/i, "generated OpenWiki ownership rule is missing");

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
