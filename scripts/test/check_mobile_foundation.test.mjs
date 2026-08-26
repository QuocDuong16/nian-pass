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
