import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runChecks } from "../check_mobile_foundation.mjs";

function write(root, name, content = "generated\n") {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-mobile-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, ".gitignore", "/target/\n");
  write(
    root,
    "apps/desktop/src-tauri/gen/android/.gitignore",
    "local.properties\nkey.properties\nkeystore.properties\n.gradle\nbuild\n/.tauri\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/build.gradle.kts",
    "android { compileSdk = 36; defaultConfig { minSdk = 26 } }\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml",
    "<manifest><application /></manifest>\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/debug/AndroidManifest.xml",
    '<manifest><uses-permission android:name="android.permission.INTERNET" /></manifest>\n',
  );
  write(
    root,
    "apps/desktop/src-tauri/Cargo.toml",
    '[lib]\ncrate-type = ["staticlib", "cdylib", "rlib"]\n',
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/buildSrc/src/main/java/dev/nian/pass/kotlin/RustPlugin.kt",
    'listOf("aarch64", "armv7", "i686", "x86_64")\n',
  );
  write(
    root,
    "apps/desktop/vite.config.ts",
    'const mobileDevHost = loadEnv(mode, ".", "")["TAURI_DEV_HOST"];\nconst host = mobileDevHost ?? "127.0.0.1";\n',
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/VaultSourcePlugin.kt",
    `Intent.ACTION_OPEN_DOCUMENT
Intent.CATEGORY_OPENABLE
contentResolver.openInputStream
OpenableColumns.DISPLAY_NAME
noBackupFilesDir
nian-pass-imports
FileOutputStream
ByteArray(DEFAULT_BUFFER_SIZE)
takePersistableUriPermission
releasePersistableUriPermission
openFileDescriptor(uri, "rwt")
WRITE_STARTED
fingerprint(save.candidate)
fingerprint(save.readBack)
`,
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/VaultSourcePolicy.kt",
    "UUID.randomUUID()\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/test/java/dev/nian/pass/VaultSourcePolicyTest.kt",
    "isManagedStagingName\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/VaultSourceJournal.kt",
    "AtomicFile WRITE_STARTED\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/src/mobile/generation.rs",
    "struct EncryptedGeneration;\n",
  );
  write(root, "apps/desktop/src-tauri/src/mobile/mutations.rs");
  write(root, "apps/desktop/src-tauri/src/mobile/persistence.rs", "verify_semantic_equivalence\n");
  write(
    root,
    "apps/desktop/src-tauri/src/mobile/session.rs",
    "KdbxDocument::open(staged_path, password)\n",
  );
  write(root, "apps/desktop/src-tauri/src/mobile/state.rs");
  write(root, "apps/desktop/src-tauri/src/mobile/source.rs");
  write(
    root,
    "apps/desktop/src-tauri/src/lib.rs",
    `fn run_mobile() {
generate_handler![
runtime_info,
mobile_select_vault,
mobile_unlock_vault,
mobile_vault_snapshot,
mobile_entry_detail,
mobile_load_entry_title,
mobile_load_entry_username,
mobile_load_entry_url,
mobile_load_entry_notes,
mobile_load_entry_custom_field,
mobile_update_entry,
mobile_create_entry,
mobile_delete_entry,
mobile_move_entry,
mobile_create_group,
mobile_rename_group,
mobile_move_group,
mobile_delete_group,
mobile_set_entry_custom_field,
mobile_delete_entry_custom_field,
mobile_save_vault,
mobile_reload_vault,
mobile_lock_vault,
mobile_discard_changes_and_lock
]
expect("Nian Pass Android runtime failed");
}
`,
  );
  for (const path of [
    "apps/desktop/src/lib/mobile.ts",
    "apps/desktop/src/types/mobile.ts",
    "apps/desktop/src/features/mobile/MobileVaultApp.tsx",
    "apps/desktop/src/features/mobile/MobileLockedView.tsx",
  ]) {
    write(root, path);
  }
  for (const path of [
    "apps/desktop/src-tauri/gen/android/gradlew",
    "apps/desktop/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar",
    "apps/desktop/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties",
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/MainActivity.kt",
  ]) {
    write(root, path);
  }
  return root;
}

test("complete deterministic Android foundation passes", (t) => {
  assert.deepEqual(runChecks(fixture(t)), []);
});

test("API 24 and ignored generated sources are rejected", (t) => {
  const root = fixture(t);
  write(root, ".gitignore", "/apps/desktop/src-tauri/gen/\n");
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/build.gradle.kts",
    "android { compileSdk = 36; defaultConfig { minSdk = 24 } }\n",
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /must not be ignored wholesale/);
  assert.match(violations, /minSdk = 26/);
});

test("normal Vite hosting cannot be broadened silently", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/vite.config.ts",
    'const mobileDevHost = loadEnv(mode, ".", "")["TAURI_DEV_HOST"];\nconst host = true;\n',
  );
  assert.match(runChecks(root).join("\n"), /loopback-only hosting/);
});

test("Android-compatible Rust library outputs are required", (t) => {
  const root = fixture(t);
  write(root, "apps/desktop/src-tauri/Cargo.toml", "[lib]\n");
  assert.match(runChecks(root).join("\n"), /staticlib, cdylib, and rlib/);
});

test("broad generated Android filesystem providers are rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml",
    '<manifest><application><provider android:name="androidx.core.content.FileProvider" /></application></manifest>\n',
  );
  assert.match(runChecks(root).join("\n"), /filesystem provider/);
});

test("main manifest INTERNET permission is rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml",
    '<manifest><uses-permission android:name="android.permission.INTERNET" /><application /></manifest>\n',
  );
  assert.match(runChecks(root).join("\n"), /release\/main.*INTERNET/);
});

test("debug manifest must contain INTERNET permission", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/debug/AndroidManifest.xml",
    "<manifest />\n",
  );
  assert.match(runChecks(root).join("\n"), /debug.*INTERNET exactly once/);
});

test("dangerous debug permissions are rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/debug/AndroidManifest.xml",
    '<manifest><uses-permission android:name="android.permission.INTERNET" /><uses-permission android:name="android.permission.CAMERA" /></manifest>\n',
  );
  assert.match(runChecks(root).join("\n"), /must not request CAMERA/);
});

test("native bridge source-path and whole-buffer shortcuts are rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/VaultSourcePlugin.kt",
    `Intent.ACTION_OPEN_DOCUMENT
Intent.CATEGORY_OPENABLE
contentResolver.openInputStream
OpenableColumns.DISPLAY_NAME
noBackupFilesDir
nian-pass-imports
FileOutputStream
ByteArray(DEFAULT_BUFFER_SIZE)
uri.getPath()
readBytes()
takePersistableUriPermission()
`,
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /Uri.getPath/);
  assert.match(violations, /whole-document byte loading/);
  assert.doesNotMatch(violations, /persistable URI grants/);
});

test("mobile VaultSession and unreviewed commands are rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/src/mobile/state.rs",
    "VaultSession::open(staged_path, password)\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/src/lib.rs",
    `fn run_mobile() {
generate_handler![runtime_info, mobile_select_vault, mobile_unlock_vault, mobile_vault_snapshot, mobile_entry_detail, mobile_lock_vault, save_vault]
expect("Nian Pass Android runtime failed");
}
`,
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /must not use VaultSession/);
  assert.match(violations, /reviewed semantic whitelist/);
});

test("mobile TypeScript transport identifiers are rejected", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src/types/mobile.ts",
    "interface Selection { contentUri: string; stagedPath?: string }\n",
  );
  assert.match(runChecks(root).join("\n"), /must not expose URI or path/);
});
