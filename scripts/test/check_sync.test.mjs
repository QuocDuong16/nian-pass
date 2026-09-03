import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runChecks } from "../check_sync.mjs";

function write(root, name, content) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function replace(root, name, before, after) {
  const path = join(root, name);
  writeFileSync(path, readFileSync(path, "utf8").replace(before, after));
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-sync-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "crates/vault-sync/Cargo.toml", "[dependencies]\n");
  write(root, "crates/sync-provider-core/Cargo.toml", "[dependencies]\n");
  write(
    root,
    "crates/sync-provider-core/src/lib.rs",
    "fn create_if_absent() {}\nfn replace_if_revision() {}\n",
  );
  write(root, "crates/sync-engine/Cargo.toml", "[dependencies]\n");
  write(
    root,
    "crates/sync-engine/src/engine.rs",
    "pub async fn sync() { self.invalidate_pending_conflict()?; let local = capture_clean()?; }\n" +
      "fn resolve(pending: Pending) { self.require_base_unchanged(pending.base_digest.as_ref())?; }\n",
  );
  write(
    root,
    "crates/sync-engine/src/conflict_authority.rs",
    "struct PendingConflict { base_digest: Option<CiphertextDigest> }\n",
  );
  write(
    root,
    "crates/sync-engine/src/store.rs",
    "pub struct TargetBinding(String);\n" +
      "struct SyncStore { target: TargetBinding }\n" +
      "struct BaseMetadata { target: TargetBinding }\n" +
      "struct JournalRecord { target: TargetBinding }\n" +
      "fn validate(target: &TargetBinding) { if target != &self.target { return Err(WrongTarget); } }\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/src/sync/profile.rs",
    "#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]\n" +
      "enum SyncProfileTargetDto { Webdav }\n" +
      "fn normalized() {}\nfn target_binding() {}\n" +
      "fn save() { if existing.source_binding != source_binding || existing.target != target { reject(); } }\n",
  );
  write(
    root,
    "crates/sync-provider-webdav/src/lib.rs",
    "fn client() { Policy::none(); scheme() == \"https\"; is_loopback(); }\n",
  );
  write(
    root,
    "crates/sync-provider-s3/src/lib.rs",
    "fn client() { scheme() == \"https\"; is_loopback(); with_max_attempts(1); }\n",
  );
  write(root, "apps/browser-native-host/Cargo.toml", "[dependencies]\n");
  write(
    root,
    "apps/desktop/src-tauri/Cargo.toml",
    "[target.'cfg(not(any(target_os = \"android\", target_os = \"ios\")))'.dependencies]\nsync-provider-webdav = {}\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml",
    "<manifest />\n",
  );
  write(
    root,
    "docs/architecture.md",
    "profile_id identifies one immutable local-source + remote-target relationship. " +
      "A malicious or broken server may ignore CAS, and the client cannot always detect that violation.\n",
  );
  write(
    root,
    "docs/threat-model.md",
    "A malicious or broken provider can violate CAS and this cannot always be detected. " +
      "Concurrency protection applies when the provider cooperates. There is no cryptographic remote rollback or conditional-enforcement claim.\n",
  );
  return root;
}

test("complete M7 remediation source policy passes", (t) => {
  assert.deepEqual(runChecks(fixture(t)), []);
});

test("mutable profile targets are rejected", (t) => {
  const root = fixture(t);
  replace(
    root,
    "apps/desktop/src-tauri/src/sync/profile.rs",
    " || existing.target != target",
    "",
  );
  assert.match(runChecks(root).join("\n"), /retain one typed normalized remote target/);
});

test("missing persisted target binding is rejected", (t) => {
  const root = fixture(t);
  replace(
    root,
    "crates/sync-engine/src/store.rs",
    "struct JournalRecord { target: TargetBinding }",
    "struct JournalRecord {}",
  );
  assert.match(runChecks(root).join("\n"), /BASE and journal must remain bound/);
});

test("stale conflict invalidation and BASE enforcement are rejected", (t) => {
  const root = fixture(t);
  replace(
    root,
    "crates/sync-engine/src/engine.rs",
    "self.invalidate_pending_conflict()?; ",
    "",
  );
  replace(
    root,
    "crates/sync-engine/src/engine.rs",
    "self.require_base_unchanged(pending.base_digest.as_ref())?; ",
    "",
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /invalidate stale conflict authority/);
  assert.match(violations, /enforce the exact BASE state/);
});

test("malicious ignored-CAS overclaims are rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "docs/threat-model.md",
    "All ignored conditional headers are detected and fail closed.\n",
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /must not claim malicious ignored-CAS detection/);
});
