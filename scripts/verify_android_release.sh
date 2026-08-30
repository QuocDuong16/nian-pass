#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Android release verification failed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 1 ]] || fail "expected one APK path"
apk="$1"
[[ -f "${apk}" ]] || fail "APK does not exist: ${apk}"

android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "${android_sdk}" ]] || fail "ANDROID_HOME or ANDROID_SDK_ROOT is required"
aapt2="${android_sdk}/build-tools/36.0.0/aapt2"
[[ -x "${aapt2}" ]] || fail "aapt2 36.0.0 is unavailable"

merged_manifest="apps/desktop/src-tauri/gen/android/app/build/intermediates/merged_manifests/universalRelease/processUniversalReleaseManifest/AndroidManifest.xml"
[[ -f "${merged_manifest}" ]] || fail "universalRelease merged manifest is missing"

for required in \
  'dev.nian.pass.NianCredentialProviderService' \
  'android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE' \
  'android.service.credentials.CredentialProviderService' \
  'android.credentials.provider' \
  'dev.nian.pass.NianAutofillService' \
  'android.permission.BIND_AUTOFILL_SERVICE' \
  'android.service.autofill.AutofillService' \
  'android.autofill' \
  'dev.nian.pass.CredentialActivity'; do
  grep -Fq "${required}" "${merged_manifest}" || fail "merged manifest is missing ${required}"
done
grep -A8 -F 'dev.nian.pass.CredentialActivity' "${merged_manifest}" | grep -Fq 'android:exported="false"' || fail "credential Activity is not private"
if grep -Eq 'android:foregroundServiceType=|android\.permission\.BIND_ACCESSIBILITY_SERVICE|android\.accessibilityservice\.AccessibilityService|android:supportsPictureInPicture="true"' "${merged_manifest}"; then
  fail "merged manifest enables an unexpected foreground/accessibility/PiP component"
fi

permissions="$(${aapt2} dump permissions "${apk}")"
for forbidden in \
  android.permission.INTERNET \
  android.permission.READ_EXTERNAL_STORAGE \
  android.permission.WRITE_EXTERNAL_STORAGE \
  android.permission.MANAGE_EXTERNAL_STORAGE \
  android.permission.QUERY_ALL_PACKAGES \
  android.permission.FOREGROUND_SERVICE \
  android.permission.SYSTEM_ALERT_WINDOW; do
  if grep -Fq "${forbidden}" <<<"${permissions}"; then
    fail "release APK requests forbidden permission ${forbidden}"
  fi
done
if grep -Fq 'android.permission.READ_MEDIA_' <<<"${permissions}"; then
  fail "release APK requests a forbidden READ_MEDIA permission"
fi

provider_path="$(${aapt2} dump resources "${apk}" | sed -n '/xml\/credential_provider/{n;s/.*(file) \([^ ]*\).*/\1/p;q;}')"
[[ -n "${provider_path}" ]] || fail "APK credential provider metadata resource is missing"
provider_xml="$(${aapt2} dump xmltree --file "${provider_path}" "${apk}")"
grep -Fq 'android.credentials.TYPE_PASSWORD_CREDENTIAL' <<<"${provider_xml}" || fail "APK provider capability is not password"
if grep -Eiq 'PUBLIC_KEY|PASSKEY' <<<"${provider_xml}"; then
  fail "APK declares a passkey capability"
fi

printf 'Android release verified: both services registered, password-only provider, private credential Activity, no foreground service, no forbidden permissions.\n'
