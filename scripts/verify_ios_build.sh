#!/usr/bin/env bash
set -euo pipefail

app_path="${1:-}"
if [[ -z "$app_path" || ! -d "$app_path" || "$app_path" != *.app ]]; then
  echo "usage: scripts/verify_ios_build.sh /path/to/NianPass.app" >&2
  exit 2
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "iOS artifact verification requires macOS." >&2
  exit 1
fi

extensions=()
while IFS= read -r extension; do
  extensions+=("$extension")
done < <(find "$app_path/PlugIns" -mindepth 1 -maxdepth 1 -type d -name '*.appex' -print 2>/dev/null)
if [[ "${#extensions[@]}" -ne 1 ]]; then
  echo "Expected exactly one embedded Credential Provider Extension." >&2
  exit 1
fi
extension_path="${extensions[0]}"

temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT
host_entitlements="$temporary_root/host-entitlements.plist"
extension_entitlements="$temporary_root/extension-entitlements.plist"
codesign -d --entitlements :- "$app_path" >"$host_entitlements" 2>/dev/null
codesign -d --entitlements :- "$extension_path" >"$extension_entitlements" 2>/dev/null

for entitlements in "$host_entitlements" "$extension_entitlements"; do
  /usr/libexec/PlistBuddy -c 'Print :com.apple.developer.authentication-services.autofill-credential-provider' "$entitlements" \
    | grep -Fx true >/dev/null
done

plist_values() {
  local plist="$1"
  local key="$2"
  local index=0
  local value
  while value="$(/usr/libexec/PlistBuddy -c "Print :$key:$index" "$plist" 2>/dev/null)"; do
    printf '%s\n' "$value"
    index=$((index + 1))
  done
}

host_app_groups=()
while IFS= read -r value; do host_app_groups+=("$value"); done < <(
  plist_values "$host_entitlements" "com.apple.security.application-groups"
)
extension_app_groups=()
while IFS= read -r value; do extension_app_groups+=("$value"); done < <(
  plist_values "$extension_entitlements" "com.apple.security.application-groups"
)
if [[ "${#host_app_groups[@]}" -ne 1 || "${#extension_app_groups[@]}" -ne 1 ]]; then
  echo "M5.4 requires exactly one App Group on both host and extension." >&2
  exit 1
fi
if [[ "${host_app_groups[0]}" != "${extension_app_groups[0]}" ]]; then
  echo "Host and extension App Group entitlements differ." >&2
  exit 1
fi

host_keychain_groups=()
while IFS= read -r value; do host_keychain_groups+=("$value"); done < <(
  plist_values "$host_entitlements" "keychain-access-groups"
)
extension_keychain_groups=()
while IFS= read -r value; do extension_keychain_groups+=("$value"); done < <(
  plist_values "$extension_entitlements" "keychain-access-groups"
)
shared_keychain_group=""
for host_group in "${host_keychain_groups[@]}"; do
  for extension_group in "${extension_keychain_groups[@]}"; do
    if [[ "$host_group" == "$extension_group" ]]; then
      shared_keychain_group="$host_group"
    fi
  done
done
if [[ -z "$shared_keychain_group" ]]; then
  echo "Host and extension have no shared Keychain access group." >&2
  exit 1
fi

extension_point="$(/usr/libexec/PlistBuddy -c 'Print :NSExtension:NSExtensionPointIdentifier' "$extension_path/Info.plist")"
if [[ "$extension_point" != "com.apple.authentication-services-credential-provider-ui" ]]; then
  echo "Embedded extension is not an AutoFill Credential Provider." >&2
  exit 1
fi
/usr/libexec/PlistBuddy -c 'Print :NSExtension:NSExtensionAttributes:ASCredentialProviderExtensionCapabilities:ProvidesPasswords' "$extension_path/Info.plist" \
  | grep -Fx true >/dev/null
for unsupported in ProvidesPasskeys ProvidesOneTimeCodes; do
  if /usr/libexec/PlistBuddy -c "Print :NSExtension:NSExtensionAttributes:ASCredentialProviderExtensionCapabilities:$unsupported" "$extension_path/Info.plist" >/dev/null 2>&1; then
    echo "Password-only M5.4 extension must not declare $unsupported." >&2
    exit 1
  fi
done
