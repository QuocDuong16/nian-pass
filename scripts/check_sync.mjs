import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readRustProduction } from "./lib/source_policy.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

function source(root, path) {
  return readFileSync(resolve(root, path), "utf8");
}

export function runChecks(root) {
  const violations = [];
  const vaultSyncManifest = source(root, "crates/vault-sync/Cargo.toml");
  const providerCoreManifest = source(root, "crates/sync-provider-core/Cargo.toml");
  const providerCore = readRustProduction(
    resolve(root, "crates/sync-provider-core/src/lib.rs"),
  );
  const engineManifest = source(root, "crates/sync-engine/Cargo.toml");
  const profileSource = readRustProduction(
    resolve(root, "apps/desktop/src-tauri/src/sync/profile.rs"),
  );
  const engineSource = readRustProduction(resolve(root, "crates/sync-engine/src/engine.rs"));
  const conflictAuthoritySource = readRustProduction(
    resolve(root, "crates/sync-engine/src/conflict_authority.rs"),
  );
  const storeSource = [
    "crates/sync-engine/src/store.rs",
    "crates/sync-engine/src/store/metadata.rs",
    "crates/sync-engine/src/store/journal.rs",
  ]
    .map((path) => readRustProduction(resolve(root, path)))
    .join("\n");
  const syncCommands = readRustProduction(
    resolve(root, "apps/desktop/src-tauri/src/commands/sync.rs"),
  );
  const syncErrors = source(root, "apps/desktop/src/features/sync/sync-errors.ts");
  const webdavSource = readRustProduction(
    resolve(root, "crates/sync-provider-webdav/src/lib.rs"),
  );
  const s3Source = readRustProduction(resolve(root, "crates/sync-provider-s3/src/lib.rs"));
  const browserHostManifest = source(root, "apps/browser-native-host/Cargo.toml");
  const desktopManifest = source(root, "apps/desktop/src-tauri/Cargo.toml");
  const androidManifest = source(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml",
  );
  const architecture = source(root, "docs/architecture.md");
  const threatModel = source(root, "docs/threat-model.md");
  const quality = source(root, "docs/quality.md");
  const readme = source(root, "README.md");

  for (const [path, manifest] of [
    ["crates/vault-sync/Cargo.toml", vaultSyncManifest],
    ["crates/sync-provider-core/Cargo.toml", providerCoreManifest],
  ]) {
    if (/\b(?:reqwest|aws-sdk|tokio|hyper|tauri)\b/.test(manifest)) {
      violations.push(`${path}: provider-independent sync boundary gained network/runtime code`);
    }
  }
  if (/\btauri\b/.test(engineManifest)) {
    violations.push("crates/sync-engine/Cargo.toml: sync-engine must remain Tauri-independent");
  }
  if (!/create_if_absent/.test(providerCore) || !/replace_if_revision/.test(providerCore)) {
    violations.push("sync-provider-core: safe create and exact-revision replace are required");
  }
  if (/\bfn\s+(?:put_unconditional|overwrite|force_write)\b/i.test(providerCore)) {
    violations.push("sync-provider-core: blind remote write semantics are forbidden");
  }
  if (/sync-provider|sync-engine/.test(browserHostManifest)) {
    violations.push("browser native host must not depend on cloud synchronization crates");
  }
  if (!/target\.'cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)'\.dependencies[\s\S]*sync-provider-webdav/.test(desktopManifest)) {
    violations.push("desktop provider dependencies must remain outside Android and iOS targets");
  }
  if (/android\.permission\.INTERNET/.test(androidManifest)) {
    violations.push("Android INTERNET permission remains forbidden in M7");
  }
  if (/\b(?:password|secretAccessKey|secret_access_key|sessionToken|session_token|masterPassword|master_password)\b/.test(`${profileSource}\n${storeSource}`)) {
    violations.push("persistent sync profile/BASE/journal structures contain a secret field name");
  }
  if (
    !/derive\(Clone, Eq, PartialEq, Serialize, Deserialize\)[\s\S]{0,160}enum SyncProfileTargetDto/.test(
      profileSource,
    ) ||
    !/existing\.source_binding\s*!=\s*source_binding\s*\|\|\s*existing\.target\s*!=\s*target/.test(
      profileSource,
    ) ||
    !/fn normalized\([\s\S]{0,2400}fn target_binding\(/.test(profileSource)
  ) {
    violations.push("existing profile IDs must retain one typed normalized remote target");
  }
  if (
    !/pub struct TargetBinding\(/.test(storeSource) ||
    !/struct SyncStore[\s\S]{0,240}target:\s*TargetBinding/.test(storeSource) ||
    !/struct BaseMetadata[\s\S]{0,240}target:\s*TargetBinding/.test(storeSource) ||
    !/struct JournalRecord[\s\S]{0,240}target:\s*TargetBinding/.test(storeSource) ||
    !/target\s*!=\s*&self\.target[\s\S]{0,100}WrongTarget/.test(storeSource)
  ) {
    violations.push("BASE and journal must remain bound to the exact remote target");
  }
  if (
    !/enum RecoveryStatus[\s\S]{0,400}Unsupported/.test(storeSource) ||
    !/fn recovery_status[\s\S]{0,1000}metadata_schema[\s\S]{0,700}RecoveryStatus::Unsupported/.test(
      storeSource,
    ) ||
    /symlink_metadata\([\s\S]{0,180}RecoveryStatus::Required/.test(storeSource)
  ) {
    violations.push("recovery status must inspect and classify persisted schema, not file existence");
  }
  if (
    !/fn load_base[\s\S]{0,500}MetadataSchema::Unsupported[\s\S]{0,120}UnsupportedSchema/.test(
      storeSource,
    ) ||
    !/schema_version\s*==\s*SCHEMA_VERSION[\s\S]{0,180}MetadataSchema::Current[\s\S]{0,120}MetadataSchema::Unsupported/.test(
      storeSource,
    )
  ) {
    violations.push("legacy and future BASE state must never load as current target-bound state");
  }
  if (
    !/pub fn reset_state[\s\S]{0,1800}remove_if_file[\s\S]{0,900}sync_directory/.test(
      storeSource,
    ) ||
    !/fn reset_sync_state[\s\S]{0,500}begin_vault_operation/.test(syncCommands)
  ) {
    violations.push("explicit sync-state reset must remain profile-scoped and operation-gated");
  }
  if (
    !/pub async fn sync[\s\S]{0,520}invalidate_pending_conflict\(\)\?;[\s\S]{0,160}capture_clean\(\)\?/.test(
      engineSource,
    )
  ) {
    violations.push("every explicit sync must invalidate stale conflict authority before work");
  }
  if (
    !/require_base_unchanged\(pending\.base_digest\.as_ref\(\)\)\?/.test(engineSource) ||
    !/base_digest:\s*Option<CiphertextDigest>/.test(conflictAuthoritySource) ||
    /_base_digest/.test(`${engineSource}\n${conflictAuthoritySource}`)
  ) {
    violations.push("conflict resolution must enforce the exact BASE state that issued its token");
  }
  if (!/Policy::none\(\)/.test(webdavSource)) {
    violations.push("WebDAV redirects must remain disabled");
  }
  if (/danger_accept_invalid|accept_invalid_cert|tls_built_in_root_certs\s*\(\s*false/.test(webdavSource)) {
    violations.push("WebDAV TLS verification may not be weakened");
  }
  for (const [name, provider] of [
    ["WebDAV", webdavSource],
    ["S3", s3Source],
  ]) {
    if (!/scheme\(\)\s*==\s*"https"/.test(provider) || !/is_loopback/.test(provider)) {
      violations.push(`${name}: production HTTPS and loopback-only HTTP policy is missing`);
    }
  }
  if (!/with_max_attempts\(1\)/.test(s3Source)) {
    violations.push("S3 SDK retries must not blindly replay conditional PUT");
  }
  if (
    !/profile_id[\s\S]{0,200}immutable[\s\S]{0,100}local-source \+ remote-target/i.test(
      architecture,
    ) ||
    !/malicious or broken server[\s\S]{0,700}cannot always detect/i.test(architecture)
  ) {
    violations.push("architecture must document immutable targets and the ignored-CAS limit");
  }
  if (
    !/malicious or broken provider[\s\S]{0,600}cannot always be detected/i.test(threatModel) ||
    !/provider cooperates/i.test(threatModel) ||
    !/no cryptographic remote[\s\S]{0,160}conditional-enforcement/i.test(threatModel)
  ) {
    violations.push("threat model must not claim malicious ignored-CAS detection");
  }
  if (
    !/schema v2[\s\S]{0,500}target-unbound[\s\S]{0,500}not[\s\S]{0,80}migrat/i.test(
      architecture,
    ) ||
    !/schema-v1[\s\S]{0,500}never upgrades[\s\S]{0,500}metadata-only\s+reset/i.test(
      threatModel,
    ) ||
    !/v1[\s\S]{0,500}unsupported-state[\s\S]{0,500}no-BASE initial-sync/i.test(quality)
  ) {
    violations.push("docs must retain the fail-closed target-unbound sync-state upgrade policy");
  }
  if (
    /(?:prove|proven) safe conditional-write behavior/i.test(`${readme}\n${syncErrors}`)
  ) {
    violations.push("user-facing text must not claim provider-side CAS enforcement is proven");
  }
  return violations;
}

function main() {
  const violations = runChecks(repositoryRoot);
  if (violations.length === 0) {
    process.stdout.write("Sync source policy check passed.\n");
    return;
  }
  process.stderr.write(
    `Sync source policy check failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
