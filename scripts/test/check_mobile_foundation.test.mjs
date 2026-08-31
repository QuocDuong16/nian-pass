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
    'android { compileSdk = 36; defaultConfig { minSdk = 26 } }\ndependencies { implementation("androidx.credentials:credentials:1.6.0") }\n',
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml",
    `<manifest><application>
<activity android:name=".CredentialActivity" android:excludeFromRecents="true" android:exported="false" />
<service android:name=".NianCredentialProviderService" android:permission="android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE"><intent-filter><action android:name="android.service.credentials.CredentialProviderService" /></intent-filter><meta-data android:name="android.credentials.provider" /></service>
<service android:name=".NianAutofillService" android:permission="android.permission.BIND_AUTOFILL_SERVICE"><intent-filter><action android:name="android.service.autofill.AutofillService" /></intent-filter><meta-data android:name="android.autofill" /></service>
</application></manifest>
`,
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
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/NianCredentialProviderService.kt",
    "CredentialProviderService AuthenticationAction SHA-256\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/NianAutofillService.kt",
    "AutofillService callback.onSuccess()\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/CredentialActivity.kt",
    "FLAG_SECURE\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/AutofillMetadataStore.kt",
    "AndroidKeyStore AES/GCM/NoPadding setUserAuthenticationRequired(false) AtomicFile noBackupFilesDir\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/AutofillRequestRegistry.kt",
    "opaque request registry\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/AutofillIntents.kt",
    "SecureRandom data = Uri.parse random PendingIntent identity\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/CredentialTargetPolicy.kt",
    "isOriginPopulated() getOrigin(privilegedAllowlist) credential_privileged_apps_v1\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/CredentialRequestReconstructor.kt",
    "retrieveBeginGetCredentialRequest retrieveProviderGetCredentialRequest EXTRA_ASSIST_STRUCTURE\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/AutofillGrantPolicy.kt",
    "bookmarkFlags retainReadOnly coldSourceWritable(): Boolean = false\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/res/raw/credential_privileged_apps_v1.json",
    '{"apps":[{"info":{"package_name": "com.android.chrome"}}]}\n',
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/CredentialActivity.kt",
    "FLAG_SECURE onNewIntent setIntent(intent) retireForBackground CredentialCompletionGate completeCurrentRequest\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/MobileSecurityRuntime.kt",
    'FLAG_SECURE setRecentsScreenshotEnabled(false) Build.VERSION.SDK_INT PrivacyCurtainController ProcessLifecycleOwner PowerManager isInteractive SystemClock::elapsedRealtime contentDescription = "Nian Pass locked" acknowledgeSafeUi\n',
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/MobileSecurityPolicy.kt",
    "activityResumed windowFocused processForeground onProcessForegroundChanged onActivityResumed onWindowFocused onScreenStateChanged acknowledgementEligible classifyMobileScreenState expectedGeneration CurtainAttachmentModel\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/test/java/dev/nian/pass/MobileSecurityPolicyTest.kt",
    "duplicateIdenticalTransitionsAreIdempotent pauseInvalidatesOldGenerationBeforeDelayedProcessStop focusLossInvalidatesOldGenerationImmediately resumeWithoutFocusCannotAcknowledge focusWithoutResumedCannotAcknowledge screenClassifierPrioritizesInteractiveStateBeforeKeyguard curtainAndApiPoliciesAreIdempotent\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/AutofillMetadataStore.kt",
    "AndroidKeyStore AES/GCM/NoPadding setUserAuthenticationRequired(false) AtomicFile noBackupFilesDir AutofillGrantPolicy.normalize\n",
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
retainAutofillReadGrant
`,
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/res/xml/credential_provider.xml",
    '<credential-provider><capability name="android.credentials.TYPE_PASSWORD_CREDENTIAL" /></credential-provider>\n',
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/res/xml/autofill_service.xml",
    "<autofill-service />\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/src/mobile/autofill.rs",
    "AndroidApp entry_password credential_provider_core::candidates credential_provider_core::credential CredentialTarget::android_app CredentialTarget::web_domain\n",
  );
  write(root, "apps/desktop/src-tauri/src/mobile/autofill_commands.rs");
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
  write(root, "apps/desktop/src-tauri/src/mobile/state_autofill.rs");
  write(root, "apps/desktop/src-tauri/src/mobile/security_commands.rs");
  write(root, "apps/desktop/src-tauri/src/mobile/source_security.rs");
  write(root, "apps/desktop/src-tauri/src/mobile/state_security.rs");
  write(root, "apps/desktop/src-tauri/src/mobile/source.rs");
  write(root, "apps/desktop/src-tauri/src/mobile/source_autofill.rs");
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
mobile_autofill_status
mobile_enable_autofill_for_vault
mobile_disable_autofill_for_vault
mobile_autofill_request
mobile_autofill_candidates
mobile_autofill_publish_candidates
mobile_autofill_approve
mobile_autofill_cancel
mobile_open_autofill_settings
mobile_security_resume
mobile_security_acknowledge_safe_ui
]
expect("Nian Pass Android runtime failed");
}
#[cfg(target_os = "ios")]
fn run_mobile() {
generate_handler![runtime_info, mobile_select_vault, mobile_unlock_vault, mobile_vault_snapshot, mobile_entry_detail, mobile_lock_vault, mobile_autofill_status, mobile_enable_autofill_for_vault, mobile_disable_autofill_for_vault, mobile_refresh_ios_autofill_mirror, mobile_open_autofill_settings]
.run(tauri::generate_context!());
}
`,
  );
  write(
    root,
    "crates/credential-provider-core/src/lib.rs",
    "password_identities CredentialTarget::ios_url entry_matches_target entry_password\n",
  );
  write(
    root,
    "crates/ios-credential-ffi/src/ffi.rs",
    "np_ios_open_vault np_ios_copy_candidates_json np_ios_copy_identities_json np_ios_copy_credential np_ios_close_vault np_ios_free_buffer np_ios_free_secret_result catch_unwind\n",
  );
  write(
    root,
    "crates/ios-credential-ffi/src/session.rs",
    "verified_mirror(&path) actual != expected KdbxDocument::open_reader(&mut mirror\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/src/mobile/source_ios.rs",
    "ios_plugin_binding! selectVault releaseSource enableAutofill refreshAutofill disableAutofill openCredentialProviderSettings\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/src/mobile/ios_commands.rs",
    "IdentityProjection password_identities\n",
  );
  write(root, "apps/desktop/src/lib/mobile.ts");
  write(root, "apps/desktop/src/lib/mobile-security-validation.ts");
  write(root, "apps/desktop/src/lib/mobile-autofill.ts");
  write(
    root,
    "apps/desktop/src/types/mobile.ts",
    "export interface AutofillCandidateDto {\nentryId: string;\ntitle: SummaryTextDto;\nusername: SummaryTextDto;\n}\n",
  );
  for (const path of [
    "apps/desktop/src/features/mobile/MobileVaultApp.tsx",
    "apps/desktop/src/features/mobile/MobileLockedView.tsx",
    "apps/desktop/src/features/mobile/MobileAutofillPanel.tsx",
    "apps/desktop/src/features/mobile/MobileAutofillSettings.tsx",
    "apps/desktop/src/features/mobile/MobileSecurityShield.tsx",
    "apps/desktop/src/features/mobile/MobileTransitionShield.tsx",
    "apps/desktop/src/features/mobile/MobileUnlockedView.tsx",
    "apps/desktop/src/features/mobile/MobileUnlockedHeader.tsx",
    "apps/desktop/src/features/mobile/useAcknowledgeLockedMobileUi.ts",
    "apps/desktop/src/features/mobile/useMobileAutofillLaunch.ts",
    "apps/desktop/src/features/mobile/useMobileIdleSecurity.ts",
    "apps/desktop/src/features/mobile/useMobileSecurityReconciliation.ts",
    "apps/desktop/src/features/mobile/useMobileUnlockedSecurity.ts",
  ]) {
    write(root, path);
  }
  write(
    root,
    "apps/desktop/src/features/mobile/useMobileSecurityLifecycle.ts",
    "acknowledgementVersion windowFocused.current refreshRequest === requestVersion.current latest?.generation === generation\n",
  );
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

test("M5.3 service binding and password-only capability are required", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/res/xml/credential_provider.xml",
    '<credential-provider><capability name="androidx.credentials.TYPE_PUBLIC_KEY_CREDENTIAL" /></credential-provider>\n',
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml",
    "<manifest><application /></manifest>\n",
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /password-only/);
  assert.match(violations, /BIND_CREDENTIAL_PROVIDER_SERVICE/);
  assert.match(violations, /BIND_AUTOFILL_SERVICE/);
});

test("M5.3 dependency and native metadata persistence cannot drift", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/build.gradle.kts",
    'android { compileSdk = 36; defaultConfig { minSdk = 26 } }\ndependencies { implementation("androidx.credentials:credentials:1.7.0-alpha01"); implementation("androidx.credentials:credentials-play-services-auth:+") }\n',
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/AutofillMetadataStore.kt",
    "AndroidKeyStore AES/GCM/NoPadding setUserAuthenticationRequired(false) AtomicFile noBackupFilesDir SharedPreferences\n",
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /must pin.*1.6.0/);
  assert.match(violations, /must not float/);
  assert.match(violations, /SharedPreferences/);
});

test("M5.3 frontend and Autofill SaveRequest cannot bypass semantic Rust", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src/lib/mobile.ts",
    'invoke("plugin:autofill|fulfill")\n',
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/NianAutofillService.kt",
    "AutofillService SaveInfo setSaveInfo callback.onSuccess()\n",
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /frontend must not receive or invoke native/);
  assert.match(violations, /SaveRequest must not mutate/);
});

test("M5.3 origin, reconstruction, PendingIntent, and READ-only grant ratchets cannot drift", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/CredentialTargetPolicy.kt",
    "browser package fallback\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/CredentialRequestReconstructor.kt",
    "custom token only\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/AutofillIntents.kt",
    "AtomicInteger FLAG_UPDATE_CURRENT\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/AutofillGrantPolicy.kt",
    "WRITE retained\n",
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /privileged caller allowlist/);
  assert.match(violations, /reconstruct framework requests/);
  assert.match(violations, /PendingIntent identity must be random/);
  assert.match(violations, /retain READ only/);
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

test("M5.5 secure lifecycle, monotonic time, and memory-only policy cannot drift", (t) => {
  const root = fixture(t);
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/MobileSecurityRuntime.kt",
    "System.currentTimeMillis()\n",
  );
  write(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/CredentialActivity.kt",
    "FLAG_SECURE onNewIntent setIntent(intent)\n",
  );
  write(
    root,
    "apps/desktop/src/features/mobile/useMobileIdleSecurity.ts",
    "Date.now(); localStorage.setItem('timeout', 'never'); new BiometricPrompt();\n",
  );
  const violations = runChecks(root).join("\n");
  assert.match(violations, /native security lifecycle must retain/);
  assert.match(violations, /never wall clock time/);
  assert.match(violations, /application-memory only/);
  assert.match(violations, /biometric quick unlock must remain deferred/);
  assert.match(violations, /CredentialActivity lifecycle must retain/);
});
