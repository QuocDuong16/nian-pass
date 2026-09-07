# Canonical release procedure

Forgejo is the source-development and canonical routine CI authority. GitHub is
a mirror used as the production multi-platform release execution and
distribution surface. Routine branch, pull-request, scheduled, quality,
security-policy, gateway, and Windows cross-check work remains in
`.forgejo/workflows/quality.yml`. `.github/workflows/release.yml` runs only for
an explicit `v*` tag or a manual dispatch naming an existing `v*` tag; it never
builds a branch or mutates source. Apple projects, builds, signing, and runners
are not part of this procedure.

## Source and version

1. Approve one exact clean commit after canonical Forgejo CI is green. Do not
   create a release tag before that review.
2. Create one `v<VERSION>` tag at that commit and propagate that exact tag to
   the GitHub mirror. If mirroring does not propagate tags, push the existing
   tag explicitly; never recreate the same tag at another commit.
3. GitHub starts from a clean checkout of `refs/tags/<tag>` with full history. Every build compares
   its HEAD to the preflight commit and runs the repository source gate.
4. `make release-source-check` fails on a dirty tree, a missing/mismatched
   tag, `refs/tags/<tag>^{commit} != HEAD`, drift from `VERSION`, unpinned
   dependencies/actions/images, or toolchain disagreement.

Release preflight runs `release-source-check`, `release-policy-check`, and
`security-hardening-check`. It relies on the observed Forgejo result for the
full routine `quality-check`; it does not duplicate that expensive development
pipeline merely to obtain another badge.

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

GitHub release jobs build independently on native `windows-2025` and Linux
`ubuntu-24.04` hosted runners. Windows produces MSVC/NSIS and its native host;
Linux produces AppImage/deb and the executable-mode-preserving native-host ZIP;
separate jobs produce browser, Android, and gateway payloads. Each job uploads
only its payload. The attest job rejects unexpected files while assembling one
canonical set, then scans and hashes the exact bytes later passed to GitHub
Release. Hosted runner VM labels are external infrastructure, not immutable
digest-pinned build environments; provenance records that limitation.

## Artifact integrity and signing

Downloaded platform payloads are separated under ignored
`artifacts/platforms/<platform>/`. `make release-assemble` accepts only the
documented Windows, Linux, browser, Android, and gateway payload patterns and
copies them into a clean `artifacts/release/`. Then `make
release-artifact-check` scans names, inspectable browser archives and
bytes for forbidden files, known secret sentinels, and secret-like text
assignments. It recursively inspects bounded gzip TAR archives, Docker saved
image plain nested `layer.tar` files, and Debian package payload TARs without
executing them, then emits
`sbom.cdx.json`, writes a
commit/tag/toolchain/artifact `release-manifest.json`, and generates
`SHA256SUMS`. This scan is a regression defense, not proof of total secret
absence, and it does not claim coverage of opaque proprietary installer
formats.

Signing is optional only when credentials are unavailable, not implicit. The
Windows job can import a PFX from its two job-scoped GitHub secrets, sign and
verify the native host/NSIS output with SHA-256 Authenticode, then remove the
temporary certificate. Android uses its four job-scoped signing values and a
temporary decoded keystore; partial signing configuration fails closed.
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

Every release report uses the status matrix requested by M8. Process-level
diagnostics and package checks are not full GUI/device runtime validation.
`NOT RUN` never becomes `PASS`; unsigned never becomes signed. Tag runs and
manual dry-runs stage a draft/prerelease by default. A manual operator may
explicitly publish a prerelease only after reviewing the canonical artifact
set; this workflow never calls an experimental release stable. Publish
checksums, SBOM status, release notes, known accepted risks, and the exact
commit. A gateway volume is
not trusted history. Back up stopped volumes independently. Nian Pass cannot
recover a forgotten KDBX master password; lost provider credentials or gateway
tokens must be rotated/replaced at the provider or gateway. Start from
[`release-status-template.md`](release-status-template.md) so no platform or
signing status silently disappears.
