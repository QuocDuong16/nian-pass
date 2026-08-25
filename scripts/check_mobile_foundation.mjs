import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..");

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
  if (/FileProvider|FILE_PROVIDER_PATHS|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/.test(manifest)) {
    violations.push(
      "M5.0 Android manifest must not expose a filesystem provider or storage permission",
    );
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
