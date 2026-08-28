import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..");
const internetPermission = "android.permission.INTERNET";
const dangerousDebugPermissions = [
  "READ_EXTERNAL_STORAGE",
  "WRITE_EXTERNAL_STORAGE",
  "MANAGE_EXTERNAL_STORAGE",
  "QUERY_ALL_PACKAGES",
  "REQUEST_INSTALL_PACKAGES",
  "SYSTEM_ALERT_WINDOW",
  "READ_CONTACTS",
  "WRITE_CONTACTS",
  "CAMERA",
  "RECORD_AUDIO",
  "ACCESS_FINE_LOCATION",
  "ACCESS_COARSE_LOCATION",
  "BLUETOOTH_CONNECT",
];

function requireFile(root, path, violations) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) {
    violations.push(`${path}: required Android foundation file is missing`);
    return "";
  }
  return readFileSync(absolute, "utf8");
}

export function runChecks(root) {
  const violations = [];
  const rootIgnore = requireFile(root, ".gitignore", violations);
  const androidIgnore = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/.gitignore",
    violations,
  );
  const gradle = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/build.gradle.kts",
    violations,
  );
  const manifest = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml",
    violations,
  );
  const debugManifest = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/debug/AndroidManifest.xml",
    violations,
  );
  const cargoManifest = requireFile(
    root,
    "apps/desktop/src-tauri/Cargo.toml",
    violations,
  );
  const rustPlugin = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/buildSrc/src/main/java/dev/nian/pass/kotlin/RustPlugin.kt",
    violations,
  );
  const vite = requireFile(root, "apps/desktop/vite.config.ts", violations);
  const nativeBridge = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/VaultSourcePlugin.kt",
    violations,
  );
  const nativePolicy = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/VaultSourcePolicy.kt",
    violations,
  );
  const nativePolicyTest = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/test/java/dev/nian/pass/VaultSourcePolicyTest.kt",
    violations,
  );
  const nativeJournal = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/VaultSourceJournal.kt",
    violations,
  );
  const credentialProvider = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/NianCredentialProviderService.kt",
    violations,
  );
  const autofillService = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/NianAutofillService.kt",
    violations,
  );
  const credentialActivity = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/CredentialActivity.kt",
    violations,
  );
  const autofillMetadata = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/AutofillMetadataStore.kt",
    violations,
  );
  const autofillRegistry = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/AutofillRequestRegistry.kt",
    violations,
  );
  const autofillIntents = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/AutofillIntents.kt",
    violations,
  );
  const credentialTargetPolicy = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/CredentialTargetPolicy.kt",
    violations,
  );
  const credentialReconstructor = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/CredentialRequestReconstructor.kt",
    violations,
  );
  const autofillGrantPolicy = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/AutofillGrantPolicy.kt",
    violations,
  );
  const privilegedAllowlist = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/res/raw/credential_privileged_apps_v1.json",
    violations,
  );
  const credentialProviderXml = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/res/xml/credential_provider.xml",
    violations,
  );
  const autofillServiceXml = requireFile(
    root,
    "apps/desktop/src-tauri/gen/android/app/src/main/res/xml/autofill_service.xml",
    violations,
  );
  const mobileRust = [
    "apps/desktop/src-tauri/src/mobile/generation.rs",
    "apps/desktop/src-tauri/src/mobile/autofill.rs",
    "apps/desktop/src-tauri/src/mobile/autofill_commands.rs",
    "apps/desktop/src-tauri/src/mobile/mutations.rs",
    "apps/desktop/src-tauri/src/mobile/persistence.rs",
    "apps/desktop/src-tauri/src/mobile/session.rs",
    "apps/desktop/src-tauri/src/mobile/state.rs",
    "apps/desktop/src-tauri/src/mobile/source.rs",
    "apps/desktop/src-tauri/src/mobile/source_autofill.rs",
    "apps/desktop/src-tauri/src/mobile/state_autofill.rs",
  ]
    .map((path) => requireFile(root, path, violations))
    .join("\n");
  const rustHost = requireFile(
    root,
    "apps/desktop/src-tauri/src/lib.rs",
    violations,
  );
  const mobileFrontend = [
    "apps/desktop/src/lib/mobile.ts",
    "apps/desktop/src/lib/mobile-autofill.ts",
    "apps/desktop/src/types/mobile.ts",
    "apps/desktop/src/features/mobile/MobileVaultApp.tsx",
    "apps/desktop/src/features/mobile/MobileLockedView.tsx",
    "apps/desktop/src/features/mobile/MobileAutofillPanel.tsx",
    "apps/desktop/src/features/mobile/MobileAutofillSettings.tsx",
  ]
    .map((path) => requireFile(root, path, violations))
    .join("\n");

  for (const path of [
    "apps/desktop/src-tauri/gen/android/gradlew",
    "apps/desktop/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar",
    "apps/desktop/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties",
    "apps/desktop/src-tauri/gen/android/app/src/main/java/dev/nian/pass/MainActivity.kt",
  ]) {
    requireFile(root, path, violations);
  }

  if (/^\/apps\/desktop\/src-tauri\/gen\/?$/m.test(rootIgnore)) {
    violations.push(
      ".gitignore: deterministic generated mobile projects must not be ignored wholesale",
    );
  }
  const minSdk = [...gradle.matchAll(/\bminSdk\s*=\s*(\d+)/g)].map(
    (match) => match[1],
  );
  if (minSdk.length !== 1 || minSdk[0] !== "26") {
    violations.push(
      "Android Gradle configuration must set exactly minSdk = 26",
    );
  }
  if (!/\bcompileSdk\s*=\s*36\b/.test(gradle)) {
    violations.push(
      "Android Gradle configuration must retain generated compileSdk 36",
    );
  }
  if (
    !/crate-type\s*=\s*\[\s*"staticlib"\s*,\s*"cdylib"\s*,\s*"rlib"\s*\]/.test(
      cargoManifest,
    )
  ) {
    violations.push(
      "Tauri Rust library must emit staticlib, cdylib, and rlib artifacts",
    );
  }
  for (const [component, permission, action, metadata] of [
    [
      "NianCredentialProviderService",
      "android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE",
      "android.service.credentials.CredentialProviderService",
      "android.credentials.provider",
    ],
    [
      "NianAutofillService",
      "android.permission.BIND_AUTOFILL_SERVICE",
      "android.service.autofill.AutofillService",
      "android.autofill",
    ],
  ]) {
    for (const required of [component, permission, action, metadata]) {
      if (!manifest.includes(required)) {
        violations.push(`M5.3 manifest registration is missing ${required}`);
      }
    }
  }
  if (
    !manifest.includes('android:name=".CredentialActivity"') ||
    !manifest.includes('android:excludeFromRecents="true"') ||
    !manifest.includes('android:exported="false"')
  ) {
    violations.push("M5.3 credential Activity must be private and excluded from recents");
  }
  if (
    !credentialProviderXml.includes("android.credentials.TYPE_PASSWORD_CREDENTIAL") ||
    /PUBLIC_KEY|PASSKEY/i.test(credentialProviderXml)
  ) {
    violations.push("M5.3 Credential Provider capability must be password-only");
  }
  if (!autofillServiceXml.includes("autofill-service")) {
    violations.push("M5.3 AutofillService metadata XML is missing");
  }
  if (!/androidx\.credentials:credentials:1\.6\.0/.test(gradle)) {
    violations.push("M5.3 must pin androidx.credentials:credentials:1.6.0");
  }
  if (/credentials-play-services-auth|credentials:[^"\n]*(?:\+|latest|alpha)/i.test(gradle)) {
    violations.push("M5.3 credential dependencies must not float, use alpha, or add Play Services auth");
  }
  if (
    /FileProvider|FILE_PROVIDER_PATHS|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE|READ_MEDIA_/.test(
      manifest,
    )
  ) {
    violations.push(
      "M5.2 Android manifest must not expose a filesystem provider or storage permission",
    );
  }
  if (manifest.includes(internetPermission)) {
    violations.push(
      "M5.2 release/main Android manifest must not request INTERNET",
    );
  }
  const debugPermissions = [
    ...debugManifest.matchAll(
      /<uses-permission\b[^>]*\bandroid:name\s*=\s*["']([^"']+)["'][^>]*>/g,
    ),
  ].map((match) => match[1]);
  const debugInternetCount = debugPermissions.filter(
    (permission) => permission === internetPermission,
  ).length;
  if (debugInternetCount !== 1) {
    violations.push(
      "M5.1 debug Android manifest must request INTERNET exactly once",
    );
  }
  const unrelatedDebugPermissions = debugPermissions.filter(
    (permission) => permission !== internetPermission,
  );
  if (unrelatedDebugPermissions.length > 0) {
    violations.push(
      `M5.1 debug Android manifest may request only INTERNET; found ${unrelatedDebugPermissions.join(", ")}`,
    );
  }
  for (const permission of dangerousDebugPermissions) {
    if (debugManifest.includes(`android.permission.${permission}`)) {
      violations.push(
        `M5.1 debug Android manifest must not request ${permission}`,
      );
    }
  }
  for (const ignored of [
    "local.properties",
    "key.properties",
    "keystore.properties",
    ".gradle",
    "build",
    "/.tauri",
  ]) {
    if (!androidIgnore.split(/\r?\n/).includes(ignored)) {
      violations.push(`Android .gitignore must exclude ${ignored}`);
    }
  }
  for (const target of ["aarch64", "armv7", "i686", "x86_64"]) {
    if (!rustPlugin.includes(`"${target}"`)) {
      violations.push(
        `Generated Android Rust target list is missing ${target}`,
      );
    }
  }
  if (!vite.includes('loadEnv(mode, ".", "")')) {
    violations.push("Vite mobile development must honor TAURI_DEV_HOST");
  }
  if (!vite.includes('mobileDevHost ?? "127.0.0.1"')) {
    violations.push(
      "Vite must retain loopback-only hosting outside Tauri mobile development",
    );
  }

  for (const required of [
    "Intent.ACTION_OPEN_DOCUMENT",
    "Intent.CATEGORY_OPENABLE",
    "contentResolver.openInputStream",
    "OpenableColumns.DISPLAY_NAME",
    "noBackupFilesDir",
    "nian-pass-imports",
    "FileOutputStream",
    "takePersistableUriPermission",
    "releasePersistableUriPermission",
    "openFileDescriptor(uri, \"rwt\")",
    "WRITE_STARTED",
    "fingerprint(save.candidate)",
    "fingerprint(save.readBack)",
  ]) {
    if (!nativeBridge.includes(required)) {
      violations.push(`M5.2 Android source bridge must use ${required}`);
    }
  }
  for (const [label, pattern] of [
    ["Uri.getPath", /\.getPath\s*\(/],
    ["historical _data column", /["']_data["']/],
    ["whole-document byte loading", /readBytes\s*\(|readAllBytes\s*\(|Base64/],
    ["external staging", /externalFilesDir|getExternal|Environment\.DIRECTORY_/],
  ]) {
    if (pattern.test(nativeBridge)) {
      violations.push(`M5.2 native bridge must not use ${label}`);
    }
  }
  if (!/ByteArray\(DEFAULT_BUFFER_SIZE\)/.test(nativeBridge)) {
    violations.push("M5.2 native bridge must retain a bounded streaming buffer");
  }
  if (!/UUID\.randomUUID\(\)/.test(nativePolicy)) {
    violations.push("M5.2 staging filenames must remain opaque and random");
  }
  if (!nativePolicyTest.includes("isManagedStagingName")) {
    violations.push("M5.2 native staging policy must retain focused unit tests");
  }
  if (/\bVaultSession\b/.test(mobileRust)) {
    violations.push("M5.2 mobile Rust must not use VaultSession semantics");
  }
  if (!mobileRust.includes("KdbxDocument::open")) {
    violations.push("M5.2 mobile Rust must reuse the authoritative KdbxDocument parser");
  }
  if (/\b(?:AES|Argon2|ChaCha|KeyDerivation|Database\.open)\b/i.test(nativeBridge)) {
    violations.push("M5.1 native Kotlin must not implement KDBX or cryptography");
  }
  const androidHandler = rustHost.match(
    /fn run_mobile\(\)[\s\S]*?generate_handler!\[([\s\S]*?)\][\s\S]*?Android runtime failed/,
  )?.[1];
  const allowedCommands = new Set([
    "runtime_info",
    "mobile_select_vault",
    "mobile_unlock_vault",
    "mobile_vault_snapshot",
    "mobile_entry_detail",
    "mobile_load_entry_title",
    "mobile_load_entry_username",
    "mobile_load_entry_url",
    "mobile_load_entry_notes",
    "mobile_load_entry_custom_field",
    "mobile_update_entry",
    "mobile_create_entry",
    "mobile_delete_entry",
    "mobile_move_entry",
    "mobile_create_group",
    "mobile_rename_group",
    "mobile_move_group",
    "mobile_delete_group",
    "mobile_set_entry_custom_field",
    "mobile_delete_entry_custom_field",
    "mobile_save_vault",
    "mobile_reload_vault",
    "mobile_lock_vault",
    "mobile_discard_changes_and_lock",
    "mobile_autofill_status",
    "mobile_enable_autofill_for_vault",
    "mobile_disable_autofill_for_vault",
    "mobile_autofill_request",
    "mobile_autofill_candidates",
    "mobile_autofill_publish_candidates",
    "mobile_autofill_approve",
    "mobile_autofill_cancel",
    "mobile_open_autofill_settings",
  ]);
  if (androidHandler === undefined) {
    violations.push("M5.1 Android semantic command handler is missing");
  } else {
    const commands = androidHandler.match(/[a-z][a-z0-9_]*/g) ?? [];
    const unexpected = commands.filter((command) => !allowedCommands.has(command));
    const missing = [...allowedCommands].filter((command) => !commands.includes(command));
    if (unexpected.length > 0 || missing.length > 0) {
      violations.push("M5.2 Android command surface must match the reviewed semantic whitelist");
    }
  }
  if (/plugin:(?:vault-source|autofill|credential)|content:\/\//.test(mobileFrontend)) {
    violations.push("M5.2 frontend must not receive or invoke native document transport");
  }
  const nativeCredential = [
    credentialProvider,
    autofillService,
    credentialActivity,
    autofillMetadata,
    autofillRegistry,
    autofillIntents,
    credentialTargetPolicy,
    credentialReconstructor,
    autofillGrantPolicy,
    nativeBridge,
  ].join("\n");
  for (const required of [
    "CredentialProviderService",
    "AuthenticationAction",
    "AutofillService",
    "FLAG_SECURE",
    "SHA-256",
    "AndroidKeyStore",
    "AES/GCM/NoPadding",
    "setUserAuthenticationRequired(false)",
    "AtomicFile",
    "noBackupFilesDir",
  ]) {
    if (!nativeCredential.includes(required)) {
      violations.push(`M5.3 native credential boundary must retain ${required}`);
    }
  }
  for (const forbidden of [
    "getSharedPreferences",
    "SharedPreferences",
    "Log.d(",
    "Log.v(",
    "DatabaseKey",
    "Argon2",
    "composite key",
    "master password",
  ]) {
    if (nativeCredential.toLowerCase().includes(forbidden.toLowerCase())) {
      violations.push(`M5.3 native credential boundary must not contain ${forbidden}`);
    }
  }
  if (/\bnew\s+SaveInfo\b|\bSaveInfo\s*\(|setSaveInfo|mobile_(?:create|update|save)_/i.test(autofillService)) {
    violations.push("M5.3 Autofill SaveRequest must not mutate or advertise SaveInfo");
  }
  if (!autofillService.includes("callback.onSuccess()")) {
    violations.push("M5.3 Autofill SaveRequest must complete without persistence");
  }
  if (
    !credentialTargetPolicy.includes("isOriginPopulated()") ||
    !credentialTargetPolicy.includes("getOrigin(") ||
    !credentialTargetPolicy.includes("credential_privileged_apps_v1") ||
    !privilegedAllowlist.includes('"package_name": "com.android.chrome"')
  ) {
    violations.push("M5.3 Credential Manager web origins require a bundled privileged caller allowlist");
  }
  if (
    !credentialReconstructor.includes("retrieveBeginGetCredentialRequest") ||
    !credentialReconstructor.includes("retrieveProviderGetCredentialRequest") ||
    !credentialReconstructor.includes("EXTRA_ASSIST_STRUCTURE") ||
    !credentialActivity.includes("onNewIntent") ||
    !credentialActivity.includes("setIntent(intent)")
  ) {
    violations.push("M5.3 credential Activity must reconstruct framework requests and refresh singleTop intents");
  }
  if (
    autofillIntents.includes("AtomicInteger") ||
    !autofillIntents.includes("SecureRandom") ||
    !autofillIntents.includes("data = Uri.parse") ||
    autofillIntents.includes("FLAG_UPDATE_CURRENT")
  ) {
    violations.push("M5.3 PendingIntent identity must be random, process-independent, and collision-safe");
  }
  if (
    !autofillGrantPolicy.includes("bookmarkFlags") ||
    !autofillGrantPolicy.includes("retainReadOnly") ||
    !autofillGrantPolicy.includes("coldSourceWritable(): Boolean = false") ||
    !autofillMetadata.includes("AutofillGrantPolicy.normalize") ||
    !nativeBridge.includes("retainAutofillReadGrant")
  ) {
    violations.push("M5.3 remembered Autofill sources must retain READ only and cold-rehydrate read-only");
  }
  if (
    /BeginGetCredentialRequest|ProviderGetCredentialRequest|AssistStructure|AutofillId|\bBundle\b|\bParcel\b/.test(
      autofillMetadata,
    )
  ) {
    violations.push("M5.3 framework request objects must never enter durable Autofill metadata");
  }
  if (!mobileRust.includes("AndroidApp") || !mobileRust.includes("entry_password")) {
    violations.push("M5.3 candidate matching and narrow final secret reads must remain Rust-owned");
  }
  const candidateContract = mobileFrontend.match(
    /export interface AutofillCandidateDto\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  if (
    candidateContract === undefined ||
    /password|secret|uri|certificate|autofillId|assistStructure/i.test(candidateContract)
  ) {
    violations.push("M5.3 candidate DTO must exist and remain secret/native-identifier free");
  }
  if (
    /\b(?:contentUri|stagedPath|absolutePath|provider|documentId|uri|path)\s*[?:]/i.test(
      mobileFrontend,
    )
  ) {
    violations.push("M5.2 mobile TypeScript DTOs must not expose URI or path properties");
  }
  if (!nativeJournal.includes("AtomicFile") || !nativeJournal.includes("WRITE_STARTED")) {
    violations.push("M5.2 destructive provider writes require an AtomicFile recovery journal");
  }
  if (!mobileRust.includes("verify_semantic_equivalence") || !mobileRust.includes("EncryptedGeneration")) {
    violations.push("M5.2 Rust Save must verify candidate semantics and encrypted generations");
  }
  if (/force_save|overwrite_anyway|ignore_baseline|skip_external_check/i.test(rustHost + mobileFrontend)) {
    violations.push("M5.2 must not expose a force-save or baseline bypass");
  }

  return violations;
}

function main() {
  const violations = runChecks(repositoryRoot);
  if (violations.length === 0) {
    process.stdout.write("Mobile foundation source check passed.\n");
    return;
  }
  process.stderr.write(
    `Mobile foundation source check failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
