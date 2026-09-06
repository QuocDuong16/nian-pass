#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Mobile tool check failed: %s\n' "$1" >&2
  exit 1
}

command -v java >/dev/null 2>&1 || fail "Java/JDK not found. Install a JDK supported by Tauri Android."
command -v rustup >/dev/null 2>&1 || fail "rustup not found. Install the repository Rust toolchain first."
command -v node >/dev/null 2>&1 || fail "Node.js not found. Activate the repository-pinned Node version."
command -v pnpm >/dev/null 2>&1 || fail "pnpm not found. Activate the repository-pinned pnpm version."

java_major="$(java -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java.specification.version =/{print $2; exit}')"
[[ "${java_major}" == "21" ]] || fail "JDK 21 is required; current Java specification version is ${java_major:-unknown}."

if [[ -n "${ANDROID_HOME:-}" && -n "${ANDROID_SDK_ROOT:-}" && "${ANDROID_HOME}" != "${ANDROID_SDK_ROOT}" ]]; then
  fail "ANDROID_HOME and ANDROID_SDK_ROOT point to different SDK directories."
fi

android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "${android_sdk}" ]]; then
  fail "Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT and install the required SDK/NDK."
fi
[[ -d "${android_sdk}" ]] || fail "Android SDK directory does not exist: ${android_sdk}"

for required in \
  "platforms/android-36/android.jar" \
  "build-tools/36.0.0" \
  "platform-tools"; do
  [[ -e "${android_sdk}/${required}" ]] || fail "Missing Android SDK component ${required}. Install it with sdkmanager."
done

expected_ndk="28.2.13676358"
ndk_root="${NDK_HOME:-}"
if [[ -z "${ndk_root}" ]]; then
  ndk_root="${android_sdk}/ndk/${expected_ndk}"
fi
[[ -n "${ndk_root}" && -d "${ndk_root}/toolchains/llvm/prebuilt" ]] || fail "Android NDK not found. Set NDK_HOME or install an NDK under the Android SDK."
[[ "$(basename "${ndk_root}")" == "${expected_ndk}" ]] || fail "Android NDK ${expected_ndk} is required; current: ${ndk_root}."

installed_targets="$(rustup target list --installed)"
for target in aarch64-linux-android x86_64-linux-android; do
  grep -Fxq "${target}" <<<"${installed_targets}" || fail "Missing Rust target ${target}. Run: rustup target add ${target}"
done

expected_cli="$(node -p "require('./apps/desktop/package.json').devDependencies['@tauri-apps/cli']")"
actual_cli="$(pnpm --filter @nian-pass/desktop exec tauri --version)"
[[ "${actual_cli}" == "tauri-cli ${expected_cli}" ]] || fail "Expected Tauri CLI ${expected_cli}; current: ${actual_cli}"

printf 'Mobile tools ready: JDK 21, Android SDK 36, Build Tools 36.0.0, NDK %s, Rust Android targets, Tauri CLI %s.\n' "${expected_ndk}" "${expected_cli}"
