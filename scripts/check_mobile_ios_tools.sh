#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "mobile-ios-tools-check requires macOS; current host is $(uname -s)." >&2
  exit 1
fi

for tool in node xcodebuild xcrun xcode-select rustup pnpm; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Missing required iOS tool: $tool" >&2
    exit 1
  }
done

xcode-select -p >/dev/null
xcodebuild -version
xcrun --sdk iphoneos --show-sdk-path >/dev/null
xcrun --sdk iphonesimulator --show-sdk-path >/dev/null

for target in aarch64-apple-ios aarch64-apple-ios-sim; do
  rustup target list --installed | grep -Fx "$target" >/dev/null || {
    echo "Missing required Rust target: $target" >&2
    exit 1
  }
done

expected_tauri="$(node -p "require('./apps/desktop/package.json').devDependencies['@tauri-apps/cli'].replace(/^=/, '')")"
actual_tauri="$(pnpm --filter @nian-pass/desktop exec tauri --version | awk '{print $2}')"
if [[ "$actual_tauri" != "$expected_tauri" ]]; then
  echo "Tauri CLI $expected_tauri is required; current: $actual_tauri" >&2
  exit 1
fi

apple_root="apps/desktop/src-tauri/gen/apple"
if [[ ! -d "$apple_root" ]]; then
  echo "Missing official Tauri Apple project. Run 'pnpm --filter @nian-pass/desktop tauri ios init' on macOS." >&2
  exit 1
fi
if find "$apple_root" -name Podfile -print -quit | grep -q .; then
  command -v pod >/dev/null 2>&1 || {
    echo "CocoaPods is required by the generated Apple project." >&2
    exit 1
  }
fi
