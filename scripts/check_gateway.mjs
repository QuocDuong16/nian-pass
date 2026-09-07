import { existsSync, globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadWorkspacePackages } from "./lib/cargo_dependencies.mjs";
import { readRustProduction } from "./lib/source_policy.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

function source(root, path) {
  const absolute = resolve(root, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

function rust(root, paths) {
  return paths
    .map((path) => {
      const absolute = resolve(root, path);
      return existsSync(absolute) ? readRustProduction(absolute) : "";
    })
    .join("\n");
}

export function forbiddenRuntimeDependencies(pkg, forbidden) {
  if (pkg === undefined) return ["missing workspace package"];
  return pkg.dependencies
    .filter(
      (dependency) =>
        dependency.kind === "normal" && forbidden.has(dependency.packageName),
    )
    .map((dependency) => dependency.packageName);
}

function workflowJob(workflow, name) {
  const marker = `  ${name}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) return "";
  const remainder = workflow.slice(start + marker.length);
  const nextJob = remainder.search(/^  [A-Za-z0-9_-]+:\s*$/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

export function gatewayWorkflowDependencyViolations(workflow) {
  const job = workflowJob(workflow, "gateway-container");
  if (job === "") return ["Forgejo gateway container job is missing"];

  const violations = [];
  if (!/node_version="26\.7\.0"/.test(job)) {
    violations.push(
      "Forgejo gateway container job must install pinned Node.js 26.7.0",
    );
  }
  if (!/corepack@0\.35\.0/.test(job) || !/pnpm@11\.22\.0/.test(job)) {
    violations.push(
      "Forgejo gateway container job must install pinned Corepack and pnpm",
    );
  }
  if (!/make scripts-install/.test(job)) {
    violations.push(
      "Forgejo gateway container job must install locked source-policy dependencies",
    );
  }
  if (!/run: make gateway-container-check/.test(job)) {
    violations.push(
      "Forgejo gateway container job must run the canonical container smoke",
    );
  }
  return violations;
}

export function protocolSourceViolations({ server, storage, auth, provider, protocol = "" }) {
  const violations = [];
  if (
    !/IF_NONE_MATCH/.test(server) ||
    !/IF_MATCH/.test(server) ||
    !/PRECONDITION_REQUIRED/.test(server) ||
    !/PRECONDITION_FAILED/.test(server)
  ) {
    violations.push("gateway PUT must require create-or-exact-replace preconditions");
  }
  if (/force\s*=|overwrite\s*=|ignoreRevision|put_unconditional|force_write/i.test(server)) {
    violations.push("gateway blind-overwrite semantics are forbidden");
  }
  if (
    !/MAX_REMOTE_CIPHERTEXT_BYTES/.test(server) ||
    !/Limited::new/.test(server) ||
    !/MAX_CONCURRENT_WRITES/.test(server)
  ) {
    violations.push("gateway request bodies and concurrent writes must remain bounded");
  }
  if (
    !/Sha256::digest/.test(storage) ||
    !/fs::rename/.test(storage) ||
    !/sync_all/.test(storage) ||
    !/try_lock/.test(storage) ||
    !/object_lock/.test(storage)
  ) {
    violations.push("gateway storage must retain digest revisions, atomic install, fsync, and locking");
  }
  if (!/ct_eq/.test(auth) || !/Sha256::digest/.test(auth)) {
    violations.push("gateway bearer-token verification must remain digest-based and constant-time");
  }
  if (
    !/MIN_GATEWAY_TOKEN_BYTES:\s*usize\s*=\s*32/.test(protocol) ||
    !/MAX_GATEWAY_TOKEN_BYTES:\s*usize\s*=\s*512/.test(protocol) ||
    !/is_ascii_graphic/.test(protocol) ||
    !/valid_gateway_token/.test(auth) ||
    !/valid_gateway_token/.test(provider)
  ) {
    violations.push("gateway client and server must share the bounded visible-ASCII token policy");
  }
  if (
    !/Policy::none/.test(provider) ||
    !/scheme\(\) == "https"/.test(provider) ||
    !/is_loopback/.test(provider)
  ) {
    violations.push("gateway provider must reject redirects and require HTTPS off-loopback");
  }
  if (/danger_accept_invalid|accept_invalid_cert|tls_built_in_root_certs\s*\(\s*false/.test(provider)) {
    violations.push("gateway provider may not weaken TLS verification");
  }
  return violations;
}

export function gatewaySecretBuildContextViolations({ selfHosting, dockerignore }) {
  const documentedSecret = "deploy/gateway.env";
  const documented = selfHosting.includes(documentedSecret);
  const ignoredExactly = dockerignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === documentedSecret);
  if (!documented || !ignoredExactly) {
    return ["documented deploy/gateway.env must be excluded exactly from the Docker build context"];
  }
  if (!dockerignore.split(/\r?\n/).map((line) => line.trim()).includes("artifacts")) {
    return ["release artifacts must be excluded from the Docker build context"];
  }
  return [];
}

export function runChecks(root) {
  const violations = [];
  const packages = new Map(
    loadWorkspacePackages(root).map((pkg) => [pkg.packageName, pkg]),
  );
  const serverPackage = packages.get("nian-pass-sync-gateway");
  const providerPackage = packages.get("sync-provider-gateway");
  const protocolPackage = packages.get("sync-gateway-protocol");
  const enginePackage = packages.get("sync-engine");
  const providerCorePackage = packages.get("sync-provider-core");
  const vaultSyncPackage = packages.get("vault-sync");
  const serverForbidden = new Set([
    "keepass",
    "kdbx",
    "vault-core",
    "vault-session",
    "vault-sync",
    "credential-provider-core",
    "sync-engine",
    "sync-provider-gateway",
    "sync-provider-s3",
    "sync-provider-webdav",
    "tauri",
  ]);
  for (const dependency of forbiddenRuntimeDependencies(
    serverPackage,
    serverForbidden,
  )) {
    violations.push(`nian-pass-sync-gateway: forbidden runtime dependency ${dependency}`);
  }
  if (
    protocolPackage === undefined ||
    protocolPackage.dependencies.some((dependency) => dependency.kind === "normal") ||
    !serverPackage?.dependencies.some(
      (dependency) =>
        dependency.kind === "normal" && dependency.packageName === "sync-gateway-protocol",
    ) ||
    !providerPackage?.dependencies.some(
      (dependency) =>
        dependency.kind === "normal" && dependency.packageName === "sync-gateway-protocol",
    )
  ) {
    violations.push("gateway token policy must remain in the dependency-free shared protocol crate");
  }
  const providerForbidden = new Set([
    "keepass",
    "kdbx",
    "vault-session",
    "vault-sync",
    "sync-engine",
    "nian-pass-sync-gateway",
    "tauri",
  ]);
  for (const dependency of forbiddenRuntimeDependencies(
    providerPackage,
    providerForbidden,
  )) {
    violations.push(`sync-provider-gateway: forbidden runtime dependency ${dependency}`);
  }
  const transportDependencies = new Set([
    "reqwest",
    "hyper",
    "axum",
    "tokio",
    "aws-sdk-s3",
  ]);
  for (const [name, pkg] of [
    ["sync-provider-core", providerCorePackage],
    ["vault-sync", vaultSyncPackage],
  ]) {
    for (const dependency of forbiddenRuntimeDependencies(
      pkg,
      transportDependencies,
    )) {
      violations.push(`${name}: transport dependency ${dependency} is forbidden`);
    }
  }
  if (
    enginePackage?.dependencies.some(
      (dependency) =>
        dependency.kind === "normal" &&
        (dependency.packageName === "sync-provider-gateway" ||
          dependency.packageName === "nian-pass-sync-gateway"),
    )
  ) {
    violations.push("sync-engine must remain gateway-independent");
  }

  const server = rust(root, [
    "apps/sync-gateway/src/lib.rs",
    "apps/sync-gateway/src/main.rs",
    "apps/sync-gateway/src/server.rs",
  ]);
  const storage = rust(root, ["apps/sync-gateway/src/storage.rs"]);
  const auth = rust(root, ["apps/sync-gateway/src/auth.rs"]);
  const provider = rust(root, ["crates/sync-provider-gateway/src/lib.rs"]);
  const protocol = rust(root, ["crates/sync-gateway-protocol/src/lib.rs"]);
  violations.push(
    ...protocolSourceViolations({ server, storage, auth, provider, protocol }),
  );
  if (/\b(?:keepass|KdbxDocument|VaultSession|vault_sync)\b/.test(`${server}\n${storage}\n${auth}`)) {
    violations.push("gateway production source may not parse or depend on vault semantics");
  }
  if (/println!|dbg!|Authorization.*(?:log|trace)|request.*body.*(?:log|trace)/i.test(`${server}\n${storage}\n${auth}`)) {
    violations.push("gateway production source may not log credentials or request bodies");
  }

  const desktopManifest = source(root, "apps/desktop/src-tauri/Cargo.toml");
  if (
    !/target\.'cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)'\.dependencies[\s\S]*sync-provider-gateway/.test(
      desktopManifest,
    )
  ) {
    violations.push("gateway desktop dependency must remain excluded from Android and iOS");
  }
  const profile = rust(root, ["apps/desktop/src-tauri/src/sync/profile.rs"]);
  const store = rust(root, [
    "crates/sync-engine/src/store.rs",
    "crates/sync-engine/src/store/metadata.rs",
    "crates/sync-engine/src/store/journal.rs",
  ]);
  if (!/Gateway\s*\{[\s\S]{0,180}base_url:[\s\S]{0,120}vault_id:/.test(profile)) {
    violations.push("desktop gateway profiles must persist canonical URL and vault ID");
  }
  if (/access_token|bearer|gateway_token/i.test(`${profile}\n${store}`)) {
    violations.push("gateway token must not enter persistent profile, BASE, or journal types");
  }
  const androidManifest = source(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml",
  );
  if (/android\.permission\.INTERNET/.test(androidManifest)) {
    violations.push("Android INTERNET permission remains forbidden in M7.5");
  }
  for (const path of globSync("apps/desktop/**/*.swift", { cwd: root })) {
    if (/gateway|sync-provider/i.test(source(root, path))) {
      violations.push(`${path}: Apple runtime gateway expansion is forbidden in M7.5`);
    }
  }
  const frontendSync = globSync("apps/desktop/src/features/sync/*.{ts,tsx}", {
    cwd: root,
  })
    .map((path) => source(root, path))
    .join("\n");
  if (/setInterval|WebSocket|EventSource|startup.*sync|background.*sync/i.test(frontendSync)) {
    violations.push("background, push, and real-time sync remain out of scope");
  }
  const dockerfile = source(root, "apps/sync-gateway/Dockerfile");
  if (!/^FROM rust:1\.98\.0-bookworm@sha256:[0-9a-f]{64} AS builder$/m.test(dockerfile)
    || !/^FROM debian:bookworm-slim@sha256:[0-9a-f]{64}$/m.test(dockerfile)
    || !/USER 10001:10001/.test(dockerfile)
    || /USER\s+(?:root|0(?::0)?)/i.test(dockerfile)) {
    violations.push("Linux gateway container build is missing");
  }
  if (/^(?:ARG|ENV)\s+.*(?:GATEWAY_TOKEN|gateway.token)/im.test(dockerfile)) {
    violations.push("gateway token must never be baked into the container image");
  }
  const compose = source(root, "deploy/sync-gateway.compose.yml");
  if (
    !/NIAN_PASS_GATEWAY_TOKEN:\s*\$\{NIAN_PASS_GATEWAY_TOKEN:\?/.test(compose) ||
    /NIAN_PASS_GATEWAY_TOKEN_FILE|gateway-token\.txt|^secrets:/m.test(compose)
  ) {
    violations.push("default Compose deployment must use the private environment-file token path");
  }
  const containerCheck = source(root, "scripts/check_gateway_container.sh");
  const workflow = source(root, ".forgejo/workflows/quality.yml");
  const makefile = source(root, "Makefile");
  const selfHosting = source(root, "docs/self-hosting.md");
  const dockerignore = source(root, ".dockerignore");
  violations.push(...gatewaySecretBuildContextViolations({ selfHosting, dockerignore }));
  violations.push(...gatewayWorkflowDependencyViolations(workflow));
  if (
    !/Gateway container check passed/.test(containerCheck) ||
    !/10001:10001/.test(containerCheck) ||
    !/repository_root\}\/deploy\/gateway\.env/.test(containerCheck) ||
    !/gateway-container-check: gateway-source-check/.test(makefile)
  ) {
    violations.push("gateway container runtime smoke must remain explicit and Forgejo-owned");
  }
  if (
    /(?:--env|-e)\s+NIAN_PASS_GATEWAY_TOKEN=|--token(?:=|\s)/.test(
      `${containerCheck}\n${selfHosting}`,
    )
  ) {
    violations.push("gateway token must not be supplied in container command-line arguments");
  }
  const readme = source(root, "README.md");
  if (
    /M7\.5 Self-hosted Sync Gateway\s+DONE/.test(readme) &&
    (!/gateway-container-check/.test(makefile) || !/gateway-container/.test(workflow))
  ) {
    violations.push("M7.5 cannot be DONE without the container runtime gate");
  }
  if (
    !/reverse proxy/i.test(selfHosting) ||
    !/encrypted KDBX/i.test(selfHosting) ||
    !/active-active/i.test(selfHosting) ||
    !/not sufficient to decrypt/i.test(selfHosting)
  ) {
    violations.push("self-hosting docs must state TLS, trust, backup, and single-process limits");
  }
  return violations;
}

function main() {
  try {
    const violations = runChecks(repositoryRoot);
    if (violations.length === 0) {
      process.stdout.write("Gateway source policy check passed.\n");
      return;
    }
    process.stderr.write(
      `Gateway source policy check failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Gateway source policy check failed:\n- ${message}\n`);
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
