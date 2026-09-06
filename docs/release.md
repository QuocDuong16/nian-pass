# Canonical release procedure

Releases are explicit `v*` tag or manual Forgejo workflow runs. Routine branch
CI remains `.forgejo/workflows/quality.yml`; production packaging is never a
branch-push side effect. Apple projects, builds, signing, and runners are not
part of this procedure.

## Source and version

1. Start from a clean checkout of the exact tag. Set `RELEASE_TAG=v0.x.y`.
2. Run `make release-source-check`. It fails on a dirty tree, a missing/mismatched
   tag, drift from `VERSION`, unpinned dependencies/actions/images, or toolchain
   disagreement.
3. Run `make quality-check` and `make gateway-container-check`. Record RUN and
   PASS/FAIL separately; do not publish after a failure.

## Platform builds

- Linux: on pinned Linux tooling, `make release-linux-build`. It creates the
  Tauri AppImage and deb plus a deterministic Native Messaging host ZIP.
- Windows x86_64: on a native Windows runner with Rust MSVC and WebView/Tauri
  prerequisites, `make release-windows-build`. It creates NSIS output and the
  Windows Native Messaging host ZIP. Cross-compilation is not runtime proof.
- Browser: `make release-browser-package` creates deterministic Chromium and
  Firefox ZIPs. They retain the documented development identities and are not
  Chrome Web Store or AMO signed identities. Store publication must supply the
  final public IDs to a matching native-host build and record store signing;
  no private store key belongs in source or artifacts.
- Android: with the pinned SDK/NDK/JDK, `make release-android-build`. The release
  verifier rejects INTERNET, unexpected permissions/services, missing
  `FLAG_SECURE`, or missing native libraries. Optional signing consumes
  `NIAN_PASS_ANDROID_KEYSTORE`, `NIAN_PASS_ANDROID_KEYSTORE_PASSWORD`,
  `NIAN_PASS_ANDROID_KEY_ALIAS`, and `NIAN_PASS_ANDROID_KEY_PASSWORD` only from
  the runner environment; a partial set fails closed. With no set configured,
  the unsigned build is reported NOT CONFIGURED.
- Gateway: `make release-gateway-image` builds the digest-pinned non-root image
  with public version/commit labels and stages a deterministic-gzip Docker image
  archive plus image reference metadata. Push/tag/sign it only through an
  authorized registry step.

The current Forgejo release workflow has Docker release capacity for canonical
quality, Linux, browser, and gateway staging. No native Windows or pinned
Android runner is declared, so those builds and runtime checks remain NOT RUN
until such runners are explicitly provisioned. This is not a release PASS.

## Artifact integrity and signing

Collect outputs under ignored `artifacts/release/`, then run
`make release-artifact-check`. It scans names, inspectable browser archives and
bytes for forbidden files/test sentinels, recursively inspects bounded Debian
package and gzip/TAR container layers without executing them, emits
`sbom.cdx.json`, writes a
commit/tag/toolchain/artifact `release-manifest.json`, and generates
`SHA256SUMS`.

Signing is optional only when credentials are unavailable, not implicit. Tauri
is configured for SHA-256 Authenticode and accepts signing configuration without
code changes. Android uses Gradle signing configuration supplied by the runner.
Browser stores, container provenance, and checksum signatures are external
release-authority steps. Never place keys, certificates, passwords, tokens, or
base64 key material in Git, command arguments, logs, or artifacts. Record
`PASS`, `NOT CONFIGURED`, or `NOT RUN` for each signing target.

## Runtime smoke and report

Use only copied synthetic fixtures. Linux and Windows desktop smoke is: launch,
select, unlock, browse, mutate, Save, Lock, reopen, explicit test-gateway sync,
and browser-host handshake. Android verifies APK permissions/declarations and,
when a device exists, unlock/browse/Save/Lock, Credential Provider, Autofill,
and Activity privacy lifecycle. Browser smoke loads each package, grants one
test origin, approves one connection, fills without submit, reconnects, and
proves old approval/candidates are invalid. Gateway smoke includes non-root
startup, auth, CAS, restart persistence, locking, limits, permissions, and no
token in logs/image.

Every release report uses the status matrix requested by M8. `NOT RUN` never
becomes `PASS`; unsigned never becomes signed. Publish checksums, SBOM status,
release notes, known accepted risks, and the exact commit. A gateway volume is
not trusted history. Back up stopped volumes independently. Nian Pass cannot
recover a forgotten KDBX master password; lost provider credentials or gateway
tokens must be rotated/replaced at the provider or gateway. Start from
[`release-status-template.md`](release-status-template.md) so no platform or
signing status silently disappears.
